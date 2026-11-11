'use strict';

// 브라우저 실행·서버·앱 시나리오는 호출자가 관리한다. 외부 의존성 없음.
const record = (context, id, expected, actual, result, limitations = []) => ({
  id: ({overflow:'V08','text-contrast':'V14','control-size':'V23','console-errors':'V24','page-errors':'V24','request-failures':'V24','http-errors':'V24'})[id] ?? 'configuration',
  key: id, screen: context.screen ?? 'unspecified', width: context.width ?? null,
  state: context.state ?? 'normal', expected, actual, result, limitations
});

/**
 * options: {screen, state, selectors:{root, controls, text}, minTarget?:24}
 * CSS 선택자는 문서 전체에서 조회한다. root는 스타일 조합 측정의 범위이다.
 * 반환값: checks(판정 레코드) + 원시 레이아웃/컨트롤/대비 측정값.
 * skipped/unsupported는 pass와 다르며, 호출자가 재검토 정책을 정한다.
 */
async function measurePage(page, options = {}) {
  const { selectors = {}, minTarget = 24 } = options;
  if (!Number.isFinite(minTarget) || minTarget <= 0) throw new TypeError('minTarget must be positive');
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
    return {
      pageWidth:innerWidth,contentWidth:document.documentElement.scrollWidth,overflowElements,
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
