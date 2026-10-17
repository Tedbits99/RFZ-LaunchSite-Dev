(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[3],{8348:function(e,t,i){Promise.resolve().then(i.bind(i,1901)),Promise.resolve().then(i.bind(i,7394))},1901:function(e,t,i){"use strict";i.r(t),i.d(t,{default:function(){return d}});var r=i(7437),s=i(2265),a=i(1023),n=i(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let o={name:"eye-off",size:24,node:[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]};o.node;let l=(0,n.Z)(o);var c=i(8687);function d(e){let{initialGames:t}=e,[i,n]=(0,s.useState)(t),[o,d]=(0,s.useState)(null),u=async e=>{d(e.id);try{let t=await fetch("/api/games",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:e.id,is_active:!e.is_active})}),i=await t.json();if(!t.ok){alert(i.error||"Failed to update game.");return}n(t=>t.map(t=>t.id===e.id?{...t,is_active:i.is_active}:t))}catch(e){alert(e instanceof Error?e.message:"Network error. Please try again.")}finally{d(null)}};return(0,r.jsxs)("div",{className:"rounded-xl border border-[#1b2a45] bg-[#0b1225] p-5",children:[(0,r.jsxs)("div",{className:"mb-4 flex items-center justify-between",children:[(0,r.jsxs)("div",{children:[(0,r.jsx)("h2",{className:"font-display text-sm font-semibold",children:"Games Visibility"}),(0,r.jsx)("p",{className:"text-[11px] text-slate-500",children:"Toggle games on or off for the storefront"})]}),(0,r.jsx)("a",{href:"/admin/games",className:"text-[11px] text-cyan-300 hover:underline",children:"Manage all"})]}),(0,r.jsxs)("div",{className:"space-y-2",children:[0===i.length&&(0,r.jsx)("p",{className:"text-xs text-slate-600",children:"No games in catalog."}),i.map(e=>(0,r.jsxs)("div",{className:"flex items-center justify-between rounded-lg border border-[#1b2a45] px-3 py-2.5",children:[(0,r.jsxs)("div",{className:"flex items-center gap-2.5",children:[(0,r.jsx)("span",{className:e.is_active?"text-emerald-300":"text-slate-600",children:e.is_active?(0,r.jsx)(a.Z,{size:14}):(0,r.jsx)(l,{size:14})}),(0,r.jsxs)("div",{children:[(0,r.jsx)("p",{className:"text-xs font-medium text-slate-200",children:e.name}),(0,r.jsx)("p",{className:"text-[10px] font-bold uppercase tracking-wider ".concat(e.is_active?"text-emerald-300":"text-slate-500"),children:e.is_active?"ACTIVE":"DISABLED"})]})]}),(0,r.jsxs)("button",{onClick:()=>u(e),disabled:o===e.id,role:"switch","aria-checked":e.is_active,"aria-label":"Toggle ".concat(e.name," visibility"),className:"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ".concat(e.is_active?"bg-emerald-500/80":"bg-slate-600/60"," disabled:opacity-50"),children:[o===e.id&&(0,r.jsx)(c.Z,{size:11,className:"absolute left-1/2 -translate-x-1/2 animate-spin text-white"}),o!==e.id&&(0,r.jsx)("span",{className:"inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ".concat(e.is_active?"translate-x-5":"translate-x-1")})]})]},e.id))]})]})}},622:function(e,t,i){"use strict";/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var r=i(2265),s=Symbol.for("react.element"),a=Symbol.for("react.fragment"),n=Object.prototype.hasOwnProperty,o=r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,l={key:!0,ref:!0,__self:!0,__source:!0};function c(e,t,i){var r,a={},c=null,d=null;for(r in void 0!==i&&(c=""+i),void 0!==t.key&&(c=""+t.key),void 0!==t.ref&&(d=t.ref),t)n.call(t,r)&&!l.hasOwnProperty(r)&&(a[r]=t[r]);if(e&&e.defaultProps)for(r in t=e.defaultProps)void 0===a[r]&&(a[r]=t[r]);return{$$typeof:s,type:e,key:c,ref:d,props:a,_owner:o.current}}t.Fragment=a,t.jsx=c,t.jsxs=c},7437:function(e,t,i){"use strict";e.exports=i(622)},7394:function(e,t,i){"use strict";i.r(t),i.d(t,{default:function(){return c}});var r=i(2265);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let s=(...e)=>e.filter((e,t,i)=>!!e&&""!==e.trim()&&i.indexOf(e)===t).join(" ").trim(),a={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"},n=e=>{for(let t in e)if(t.startsWith("aria-")||"role"===t||"title"===t)return!0;return!1},o=(0,r.createContext)({}),l=()=>(0,r.useContext)(o),c=(0,r.forwardRef)(({color:e,size:t,width:i,height:o,strokeWidth:c,absoluteStrokeWidth:d,nonScalingStroke:u,className:h="",children:f,iconNode:m=[],icon:p={node:m,aliases:[],size:24},...x},w)=>{let{size:k=24,strokeWidth:b=2,absoluteStrokeWidth:g=!1,nonScalingStroke:y=!1,color:v="currentColor",className:N=""}=l()??{},_=!!f||n(x),[j,z,S=[]]=/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */function(e,t={}){return function(e,t={}){let i=t.attributeNames??{},r=e=>i[e]??e,n=e.size??e.width??a.width,o=e.size??e.height??a.height,l=e.aliases?.filter(e=>"string"==typeof e&&""!==e.trim()).map(e=>`lucide-${e}`)??[],c=[...e.name?[`lucide-${e.name}`]:[],...l],d=t.className?.split(" ").filter(Boolean)??[],u=!1===t.includeDefaultClasses?s(...d):s("lucide",...c,...d),h=t.absoluteStrokeWidth?Number(t.strokeWidth??a["stroke-width"])*Number(e.size??e.width??a.width)/Number(t.size??t.width??a.width):t.strokeWidth??a["stroke-width"],f={...Object.entries(a).reduce((e,[t,i])=>(e[r(t)]=i,e),{}),..."color"in t&&t.color&&{[r("stroke")]:t.color},..."size"in t&&null!=t.size&&{[r("width")]:t.size,[r("height")]:t.size},..."width"in t&&null!=t.width&&{[r("width")]:t.width},..."height"in t&&null!=t.height&&{[r("height")]:t.height},[r("stroke-width")]:h,...u&&{[r("class")]:u},[r("viewBox")]:`0 0 ${n} ${o}`,...!1===t.hasA11yProp?{[r("aria-hidden")]:"true"}:{},..."attributes"in t&&t.attributes};return["svg",f,e.node.map(e=>{let[i,s,a]=e,n=t.nonScalingStroke?{[r("vector-effect")]:"non-scaling-stroke",...s}:s;return a?[i,n,a]:[i,n]})]}(e,{...t,attributeNames:{...t.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}(p,{color:e??v,width:i??t??k,height:o??t??k,strokeWidth:c??b,absoluteStrokeWidth:d??g,nonScalingStroke:u??y,className:s(N,h),hasA11yProp:_,attributes:x});return(0,r.createElement)(j,{ref:w,...z},[...S.map(([e,t])=>(0,r.createElement)(e,t)),...Array.isArray(f)?f:[f]])})},2808:function(e,t,i){"use strict";i.d(t,{Z:function(){return l}});var r=i(2265);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let s=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),a=e=>{let t="",i=!1;for(let r of e){if("-"===r||"_"===r||r<=" "){i=t.length>0;continue}0===t.length?t+=r.toLowerCase():t+=i?r.toUpperCase():r,i=!1}return t},n=e=>{let t=a(e);return t.charAt(0).toUpperCase()+t.slice(1)};var o=i(7394);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */function l(e,t=[],i=[]){let a="string"==typeof e?/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */function(e,t,i=[]){if(null==t)throw Error("[lucide]: iconNode is required when icon name is used");return{name:s(e),size:24,node:t,...i.length>0?{aliases:i}:{}}}(e,t,i):e,l=(0,r.forwardRef)(({className:e,...t},i)=>(0,r.createElement)(o.default,{ref:i,icon:a,className:e,...t}));return a.name&&(l.displayName=n(a.name)),l}},1023:function(e,t,i){"use strict";i.d(t,{Z:function(){return a}});var r=i(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let s={name:"eye",size:24,node:[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]};s.node;let a=(0,r.Z)(s)},8687:function(e,t,i){"use strict";i.d(t,{Z:function(){return a}});var r=i(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let s={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};s.node;let a=(0,r.Z)(s)}},function(e){e.O(0,[2971,7864,1744],function(){return e(e.s=8348)}),_N_E=e.O()}]);