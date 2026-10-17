"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[5541],{622:function(e,t,n){/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var r=n(2265),a=Symbol.for("react.element"),i=Symbol.for("react.fragment"),o=Object.prototype.hasOwnProperty,l=r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,d={key:!0,ref:!0,__self:!0,__source:!0};function s(e,t,n){var r,i={},s=null,c=null;for(r in void 0!==n&&(s=""+n),void 0!==t.key&&(s=""+t.key),void 0!==t.ref&&(c=t.ref),t)o.call(t,r)&&!d.hasOwnProperty(r)&&(i[r]=t[r]);if(e&&e.defaultProps)for(r in t=e.defaultProps)void 0===i[r]&&(i[r]=t[r]);return{$$typeof:a,type:e,key:s,ref:c,props:i,_owner:l.current}}t.Fragment=i,t.jsx=s,t.jsxs=s},7437:function(e,t,n){e.exports=n(622)},7394:function(e,t,n){n.r(t),n.d(t,{default:function(){return s}});var r=n(2265);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a=(...e)=>e.filter((e,t,n)=>!!e&&""!==e.trim()&&n.indexOf(e)===t).join(" ").trim(),i={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"},o=e=>{for(let t in e)if(t.startsWith("aria-")||"role"===t||"title"===t)return!0;return!1},l=(0,r.createContext)({}),d=()=>(0,r.useContext)(l),s=(0,r.forwardRef)(({color:e,size:t,width:n,height:l,strokeWidth:s,absoluteStrokeWidth:c,nonScalingStroke:h,className:u="",children:f,iconNode:k=[],icon:p={node:k,aliases:[],size:24},...y},m)=>{let{size:v=24,strokeWidth:w=2,absoluteStrokeWidth:g=!1,nonScalingStroke:z=!1,color:M="currentColor",className:Z=""}=d()??{},b=!!f||o(y),[_,x,N=[]]=/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */function(e,t={}){return function(e,t={}){let n=t.attributeNames??{},r=e=>n[e]??e,o=e.size??e.width??i.width,l=e.size??e.height??i.height,d=e.aliases?.filter(e=>"string"==typeof e&&""!==e.trim()).map(e=>`lucide-${e}`)??[],s=[...e.name?[`lucide-${e.name}`]:[],...d],c=t.className?.split(" ").filter(Boolean)??[],h=!1===t.includeDefaultClasses?a(...c):a("lucide",...s,...c),u=t.absoluteStrokeWidth?Number(t.strokeWidth??i["stroke-width"])*Number(e.size??e.width??i.width)/Number(t.size??t.width??i.width):t.strokeWidth??i["stroke-width"],f={...Object.entries(i).reduce((e,[t,n])=>(e[r(t)]=n,e),{}),..."color"in t&&t.color&&{[r("stroke")]:t.color},..."size"in t&&null!=t.size&&{[r("width")]:t.size,[r("height")]:t.size},..."width"in t&&null!=t.width&&{[r("width")]:t.width},..."height"in t&&null!=t.height&&{[r("height")]:t.height},[r("stroke-width")]:u,...h&&{[r("class")]:h},[r("viewBox")]:`0 0 ${o} ${l}`,...!1===t.hasA11yProp?{[r("aria-hidden")]:"true"}:{},..."attributes"in t&&t.attributes};return["svg",f,e.node.map(e=>{let[n,a,i]=e,o=t.nonScalingStroke?{[r("vector-effect")]:"non-scaling-stroke",...a}:a;return i?[n,o,i]:[n,o]})]}(e,{...t,attributeNames:{...t.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}(p,{color:e??M,width:n??t??v,height:l??t??v,strokeWidth:s??w,absoluteStrokeWidth:c??g,nonScalingStroke:h??z,className:a(Z,u),hasA11yProp:b,attributes:y});return(0,r.createElement)(_,{ref:m,...x},[...N.map(([e,t])=>(0,r.createElement)(e,t)),...Array.isArray(f)?f:[f]])})},2808:function(e,t,n){n.d(t,{Z:function(){return d}});var r=n(2265);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),i=e=>{let t="",n=!1;for(let r of e){if("-"===r||"_"===r||r<=" "){n=t.length>0;continue}0===t.length?t+=r.toLowerCase():t+=n?r.toUpperCase():r,n=!1}return t},o=e=>{let t=i(e);return t.charAt(0).toUpperCase()+t.slice(1)};var l=n(7394);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */function d(e,t=[],n=[]){let i="string"==typeof e?/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */function(e,t,n=[]){if(null==t)throw Error("[lucide]: iconNode is required when icon name is used");return{name:a(e),size:24,node:t,...n.length>0?{aliases:n}:{}}}(e,t,n):e,d=(0,r.forwardRef)(({className:e,...t},n)=>(0,r.createElement)(l.default,{ref:n,icon:i,className:e,...t}));return i.name&&(d.displayName=o(i.name)),d}},9598:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"chart-column",size:24,node:[["path",{d:"M3 3v16a2 2 0 0 0 2 2h16",key:"c24i48"}],["path",{d:"M18 17V9",key:"2bz60n"}],["path",{d:"M13 17V5",key:"1frdt8"}],["path",{d:"M8 17v-3",key:"17ska0"}]],aliases:["bar-chart-3"]};a.node;let i=(0,r.Z)(a)},6312:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"circle-check",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m16 9-5.5 5.5L8 12",key:"xofnsj"}]],aliases:["check-circle-2"]};a.node;let i=(0,r.Z)(a)},1869:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"copy",size:24,node:[["rect",{width:"14",height:"14",x:"8",y:"8",rx:"2",ry:"2",key:"17jyea"}],["path",{d:"M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2",key:"zix9uf"}]]};a.node;let i=(0,r.Z)(a)},3631:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"dices",size:24,node:[["rect",{width:"12",height:"12",x:"2",y:"10",rx:"2",ry:"2",key:"6agr2n"}],["path",{d:"m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6",key:"1o487t"}],["path",{d:"M6 18h.01",key:"uhywen"}],["path",{d:"M10 14h.01",key:"ssrbsk"}],["path",{d:"M15 6h.01",key:"cblpky"}],["path",{d:"M18 9h.01",key:"2061c0"}]]};a.node;let i=(0,r.Z)(a)},8687:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};a.node;let i=(0,r.Z)(a)},2915:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"pencil",size:24,node:[["path",{d:"M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z",key:"1a8usu"}],["path",{d:"m15 5 4 4",key:"1mk7zo"}]]};a.node;let i=(0,r.Z)(a)},8247:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};a.node;let i=(0,r.Z)(a)},9915:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"refresh-cw",size:24,node:[["path",{d:"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8",key:"v9h5vc"}],["path",{d:"M21 3v5h-5",key:"1q7to0"}],["path",{d:"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16",key:"3uifl3"}],["path",{d:"M8 16H3v5",key:"1cv678"}]]};a.node;let i=(0,r.Z)(a)},7029:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"tag",size:24,node:[["path",{d:"M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z",key:"vktsd0"}],["circle",{cx:"7.5",cy:"7.5",r:".5",fill:"currentColor",key:"kqv944"}]]};a.node;let i=(0,r.Z)(a)},4875:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"trash",size:24,node:[["path",{d:"M10 11v6",key:"nco0om"}],["path",{d:"M14 11v6",key:"outv1u"}],["path",{d:"M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6",key:"miytrc"}],["path",{d:"M3 6h18",key:"d0wm0j"}],["path",{d:"M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",key:"e791ji"}]],aliases:["trash-2"]};a.node;let i=(0,r.Z)(a)},3209:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"triangle-alert",size:24,node:[["path",{d:"m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",key:"wmoenq"}],["path",{d:"M12 9v4",key:"juzpu7"}],["path",{d:"M12 17h.01",key:"p32p05"}]],aliases:["alert-triangle"]};a.node;let i=(0,r.Z)(a)},4862:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"x",size:24,node:[["path",{d:"M18 6 6 18",key:"1bl5f8"}],["path",{d:"m6 6 12 12",key:"d8bk6v"}]]};a.node;let i=(0,r.Z)(a)}}]);