'use strict';

// 브라우저 실행·서버·앱 시나리오는 호출자가 관리한다. 외부 의존성 없음.
const record = (context, id, expected, actual, result, limitations = []) => ({
  id: ({overflow:'V08','text-contrast':'V14','control-size':'V23','console-errors':'V24','page-errors':'V24','request-failures':'V24','http-errors':'V24','type-scale':'V28','spacing-scale':'V28'})[id] ?? 'configuration',
  key: id, screen: context.screen ?? 'unspecified', width: context.width ?? null,
  state: context.state ?? 'normal', expected, actual, result, limitations
});

/**
 * options: {screen, state, selectors:{root, controls, text}, minTarget?:24, enforceScale?:false}
 * CSS 선택자는 문서 전체에서 조회한다. root는 스타일 조합 측정의 범위이다.
 * 반환값: checks(판정 레코드) + 원시 레이아웃/컨트롤/대비 측정값.
 * skipped/unsupported는 pass와 다르며, 호출자가 재검토 정책을 정한다.
 */
async function measurePage(page, options = {}) {
  const { selectors = {}, minTarget = 24, enforceScale = false } = options;
  if (!Number.isFinite(minTarget) || minTarget <= 0) throw new TypeError('minTarget must be positive');
  if (typeof enforceScale !== 'boolean') throw new TypeError('enforceScale must be boolean');
  const metrics = await page.evaluate(({ selectors, minTarget }) => {
    const visible = el => el.getClientRects().length > 0 && !['hidden','collapse'].includes(getComputedStyle(el).visibility);
    const select = selector => {
      if (!selector) return {status:'skipped',elements:[],reason:'선택자 미설정'};
      try {
        const elements = [...document.querySelectorAll(selector)].filter(visible);
        return {status:elements.length ? 'pass' : 'fail',elements,reason:elements.length ? '' : '표시 대상 0개'};
      } catch { return {status:'unsupported',elements:[],reason:'잘못된 CSS 선택자'}; }
    };
    const root = select(selectors.root), controls = select(selectors.controls), text = select(selectors.text);
    const elementSelector = el => {
      const parts=[];
      for(let node=el;node;node=node.parentElement) {
        if(node.id && document.querySelectorAll('#'+CSS.escape(node.id)).length===1) {
          parts.unshift('#'+CSS.escape(node.id));break;
        }
        const siblings=node.parentElement?.children ?? [];
        const index=Array.from(siblings).indexOf(node)+1;
        parts.unshift(node.localName+(index ? ':nth-child('+index+')' : ''));
      }
      return parts.join(' > ');
    };
    const overflowElements=[];
    for(const el of document.querySelectorAll('body *')) {
      if(!visible(el)) continue;
      const rect=el.getBoundingClientRect();
      if(rect.width<=0 || rect.height<=0 || (rect.left>=-1 && rect.right<=innerWidth+1)) continue;
      let excluded=false;
      for(let node=el;node;node=node.parentElement) {
        const style=getComputedStyle(node);
        if(Number(style.opacity)===0 || (node!==el && ['auto','scroll'].includes(style.overflowX))) {
          excluded=true;break;
        }
      }
      if(excluded) continue;
      overflowElements.push({
        selector:elementSelector(el),left:rect.left,right:rect.right,
        top:rect.top,bottom:rect.bottom,width:rect.width,height:rect.height
      });
    }
    // getComputedStyle의 일반 sRGB 색만 지원한다. 다른 색 공간을 숫자 RGB로 오해하지 않는다.
    const rgb = value => {
      const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/.exec(value);
      return match ? [Number(match[1]),Number(match[2]),Number(match[3]),match[4] === undefined ? 1 : Number(match[4])] : null;
    };
    const blend = (color,background) => color.slice(0,3).map((v,i)=>v*color[3]+background[i]*(1-color[3]));
    const luminance = color => color.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((sum,x,i)=>sum+x*[.2126,.7152,.0722][i],0);
    const contrast = (a,b) => (Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
    const textContrast = [], unsupportedContrast = [];
    for (const el of text.elements) {
      if (![...el.childNodes].some(n=>n.nodeType===Node.TEXT_NODE && n.textContent.trim()) || el.closest('button:disabled, [aria-hidden="true"], script, style, noscript')) continue;
      const style=getComputedStyle(el), label=el.textContent.trim().slice(0,80);
      let background=[255,255,255], reason='';
      const ancestors=[];for(let n=el;n;n=n.parentElement) ancestors.unshift(n);
      for(const node of ancestors) {
        const s=getComputedStyle(node), color=rgb(s.backgroundColor);
        if(s.backgroundImage!=='none' || Number(s.opacity)!==1 || s.filter!=='none' || s.mixBlendMode!=='normal' || s.backgroundClip==='text' || s.backdropFilter!=='none') {reason='배경 이미지·opacity·필터·혼합 효과';break;}
        if(!color) {reason='지원하지 않는 배경 색 공간';break;}
        background=blend(color,background);
      }
      const foreground=rgb(style.color);
      if(!foreground) reason='지원하지 않는 전경 색 공간';
      if(style.textShadow!=='none') reason='텍스트 그림자';
      if(reason) {unsupportedContrast.push({text:label,reason});continue;}
      const size=parseFloat(style.fontSize), weight=parseFloat(style.fontWeight);
      const required=size>=24 || (size>=18.6667 && weight>=700)?3:4.5;
      // 판정에는 반올림하지 않은 값을 사용한다.
      const ratio=contrast(blend(foreground,background),background);
      textContrast.push({text:label,ratio,required});
    }
    const controlSizes=controls.elements.map(el=>{
      const original=el.getBoundingClientRect(), style=getComputedStyle(el);
      const hidden=Number(style.opacity)===0 || original.width<=1 || original.height<=1 || style.clip!=='auto' || style.clipPath!=='none';
      let rect=original, measurement='control', reason='';
      if(hidden) {
        const labels=[...(el.labels || [])].filter(label=>visible(label) && Number(getComputedStyle(label).opacity)>0)
          .map(label=>label.getBoundingClientRect()).filter(r=>r.width>0 && r.height>0)
          .sort((a,b)=>b.width*b.height-a.width*a.height);
        if(labels.length) {rect=labels[0];measurement='label';}
        else {measurement='unsupported';reason='숨긴 컨트롤에 측정 가능한 연결 label이 없음';}
      }
      return {label:el.getAttribute('aria-label')||el.textContent.trim()||el.name,width:rect.width,height:rect.height,measurement,reason};
    });
    const mobileSizes=[11,12,13,15,16,18,22,28], desktopSizes=[11,12,14,16,20,26,32];
    const allowedSizes=innerWidth<768 ? mobileSizes : desktopSizes;
    const unionSizes=[...new Set([...mobileSizes,...desktopSizes])].sort((a,b)=>a-b);
    const spacingSteps=[4,8,12,16,20,24,32,40,48,56,64,80];
    const inScale=(value,steps)=>steps.some(step=>Math.abs(value-step)<=0.500001);
    const summarize = entries => {
      const groups=new Map();
      for(const entry of entries) {
        if(!groups.has(entry.value)) groups.set(entry.value,{value:entry.value,count:0,examples:[],properties:{}});
        const group=groups.get(entry.value);
        group.count++;
        if(group.examples.length<3 && !group.examples.includes(entry.selector)) group.examples.push(entry.selector);
        if(entry.property) group.properties[entry.property]=(group.properties[entry.property] || 0)+1;
      }
      return [...groups.values()].sort((a,b)=>typeof a.value==='number' ? a.value-b.value : a.value.localeCompare(b.value));
    };
    const typeValues=[], spacingValues=[], spacingOutside=[], adjustments=[], fractional=[], relative=[], negative=[], nonPixel=[];
    const spacingProperties=['margin-top','margin-right','margin-bottom','margin-left','padding-top','padding-right','padding-bottom','padding-left','row-gap','column-gap'];
    for(const el of document.querySelectorAll('body, body *')) {
      if(!visible(el)) continue;
      const rect=el.getBoundingClientRect();
      if(rect.width<=0 || rect.height<=0) continue;
      let hidden=false;
      for(let node=el;node;node=node.parentElement) {
        const style=getComputedStyle(node);
        if(Number(style.opacity)===0 || style.clip==='rect(0px, 0px, 0px, 0px)' || style.clipPath==='inset(50%)') {
          hidden=true;break;
        }
        if(['absolute','fixed'].includes(style.position)) {
          const bounds=node.getBoundingClientRect();
          if(bounds.bottom<=0 || bounds.right<=0 || bounds.left>=innerWidth) {hidden=true;break;}
        }
      }
      if(hidden) continue;
      const style=getComputedStyle(el), selector=elementSelector(el);
      const hasText=[...el.childNodes].some(node=>node.nodeType===Node.TEXT_NODE && node.textContent.trim());
      const size=parseFloat(style.fontSize), color=rgb(style.color);
      if(hasText && size>0 && (!color || color[3]>0)) typeValues.push({value:size,selector});
      const typedStyle=typeof el.computedStyleMap==='function' ? el.computedStyleMap() : null;
      for(const property of spacingProperties) {
        const computed=style.getPropertyValue(property);
        const typed=typedStyle?.get(property)?.toString() ?? computed;
        const value=/^-?[\d.]+px$/.test(computed) ? parseFloat(computed) : null;
        const entry={value,selector,property};
        if(value!==null && Math.abs(value)<0.000001) continue;
        if(value!==null) spacingValues.push(entry);
        if(typed.includes('%') || typed==='auto') {
          relative.push({...entry,value:typed});continue;
        }
        if(value===null) {
          nonPixel.push({...entry,value:computed});continue;
        }
        if(value<0) {negative.push(entry);continue;}
        const rounded=Math.round(value);
        if(Math.abs(value-rounded)>0.01) {fractional.push(entry);continue;}
        if(rounded===1 || rounded===2) {adjustments.push(entry);continue;}
        if(!spacingSteps.includes(rounded)) spacingOutside.push(entry);
      }
    }
    const typeScale={
      result:'measured',viewport:innerWidth<768?'mobile':'desktop',
      allowed:allowedSizes,unionAllowed:unionSizes,tolerance:0.5,count:typeValues.length,
      sizes:summarize(typeValues),
      outOfScale:summarize(typeValues.filter(entry=>!inScale(entry.value,allowedSizes))),
      unionOutOfScale:summarize(typeValues.filter(entry=>!inScale(entry.value,unionSizes))),
      below11Count:typeValues.filter(entry=>entry.value<11).length,
      below11:summarize(typeValues.filter(entry=>entry.value<11))
    };
    const spacing={
      result:'measured',allowed:spacingSteps,count:spacingValues.length,
      sizes:summarize(spacingValues),outOfScale:summarize(spacingOutside),
      adjustments:summarize(adjustments),fractional:summarize(fractional),
      relative:summarize(relative),negative:summarize(negative),nonPixel:summarize(nonPixel),
      relativeSourceSupported:typeof document.body.computedStyleMap==='function'
    };
    return {
      pageWidth:innerWidth,contentWidth:document.documentElement.scrollWidth,overflowElements,typeScale,spacing,
      heading:document.querySelector('h1')?.textContent ?? '',
      textStyles:[...new Set(root.elements.flatMap(root=>[...root.querySelectorAll('*')].filter(visible).map(el=>{const s=getComputedStyle(el);return [s.fontFamily,s.fontSize,s.fontWeight,s.lineHeight].join('|');})))],
      controls:controlSizes,below24:controlSizes.filter(x=>x.measurement!=='unsupported' && (x.width<minTarget || x.height<minTarget)),
      unsupportedControls:controlSizes.filter(x=>x.measurement==='unsupported'),
      textContrast,contrastFailures:textContrast.filter(x=>x.ratio<x.required),unsupportedContrast,
      selection:{root:{status:root.status,count:root.elements.length,reason:root.reason},controls:{status:controls.status,count:controls.elements.length,reason:controls.reason},text:{status:text.status,count:textContrast.length+unsupportedContrast.length,reason:text.reason}}
    };
  }, {selectors,minTarget});
  const context = {...options,width:metrics.pageWidth};
  const root=metrics.selection.root, controls=metrics.selection.controls, text=metrics.selection.text;
  const controlResult=controls.status!=='pass'?controls.status:metrics.below24.length?'fail':metrics.unsupportedControls.length?'unsupported':'pass';
  const contrastResult=text.status!=='pass'?text.status:metrics.contrastFailures.length?'fail':metrics.unsupportedContrast.length?'unsupported':!metrics.textContrast.length?'fail':'pass';
  metrics.checks = [
    record(context,'overflow','scrollWidth <= innerWidth, 요소 좌우 끝이 뷰포트 ±1px 이내',{scrollWidth:metrics.contentWidth,innerWidth:metrics.pageWidth,elements:metrics.overflowElements},metrics.contentWidth<=metrics.pageWidth && !metrics.overflowElements.length?'pass':'fail',['가로 스크롤(auto/scroll) 조상 안의 항목 제외, 뷰포트 안의 내부 잘림·가림·의사 요소는 별도 확인']),
    record(context,'root','표시 대상 1개 이상',root,root.status,[root.reason].filter(Boolean)),
    record(context,'control-size',`선택 컨트롤 >= ${minTarget}×${minTarget}px`,{count:controls.count,violations:metrics.below24,unsupported:metrics.unsupportedControls,labelMeasurements:metrics.controls.filter(x=>x.measurement==='label')},controlResult,['사각형만 측정, 간격·문장 안 링크 예외·겹침·실제 클릭 영역은 미평가',metrics.controls.some(x=>x.measurement==='label')?'숨긴 입력은 연결 label 중 가장 큰 사각형 영역으로 측정':'',controls.reason].filter(Boolean)),
    record(context,'text-contrast','일반 글자 >=4.5:1, 큰 글자 >=3:1',{count:text.count,violations:metrics.contrastFailures,unsupported:metrics.unsupportedContrast},contrastResult,['흰 캔버스 위 일반 sRGB 합성만 지원, 가림·의사 요소·SVG는 별도 확인',text.reason].filter(Boolean))
  ];
  const typeResult=!enforceScale ? 'measured' : !metrics.typeScale.count ? 'skipped' :
    metrics.typeScale.below11Count || metrics.typeScale.unionOutOfScale.length ? 'fail' : 'pass';
  metrics.typeScale.result=typeResult;
  metrics.measurements=[
    record(context,'type-scale','모바일·PC 글자 단계 합집합 ±0.5px, 11px 미만 없음',metrics.typeScale,typeResult,['폭별 활성 단계 밖 값은 진단으로만 기록','직접 텍스트 노드가 있는 보이는 요소만 집계, 입력값·placeholder·의사 요소·텍스트 역할·부분 가림은 별도 확인']),
    record(context,'spacing-scale','간격 단계 기록',metrics.spacing,'measured',['요소·속성별 개수, gap은 row-gap/column-gap으로 정규화','auto·%는 Typed OM 지원 시 분리, 원래 em/rem 단위는 복원하지 않음','음수·1/2px 보정·소수는 별도 기록, 간격은 강제 판정하지 않음'])
  ];
  if(enforceScale) metrics.checks.push(metrics.measurements[0]);
  return metrics;
}

// 탐색 전에 연결한다. results()는 누적 스냅샷, dispose()는 리스너 해제이다.
function observePage(page) {
  const events = {consoleErrors:[],pageErrors:[],requestFailures:[],httpErrors:[]};
  const handlers = {
    console: message => {if(message.type()==='error') events.consoleErrors.push(message.text());},
    pageerror: error => events.pageErrors.push(error.message),
    requestfailed: request => events.requestFailures.push({url:request.url(),error:request.failure()?.errorText ?? ''}),
    response: response => {if(response.status()>=400) events.httpErrors.push({url:response.url(),status:response.status()});}
  };
  for(const [event,handler] of Object.entries(handlers)) page.on(event,handler);
  return {
    events,
    results(context={}) {
      return [['console-errors','consoleErrors'],['page-errors','pageErrors'],['request-failures','requestFailures'],['http-errors','httpErrors']].map(([id,key])=>record(context,id,'0 errors',[...events[key]],events[key].length?'fail':'pass',['감시 시작부터 결과 조회까지 현재 page만 검사, 다른 탭·worker 제외']));
    },
    dispose() {for(const [event,handler] of Object.entries(handlers)) page.off(event,handler);}
  };
}
module.exports = { measurePage, observePage };
