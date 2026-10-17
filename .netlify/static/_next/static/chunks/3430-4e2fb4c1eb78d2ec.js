"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[3430],{622:function(e,t,n){/**
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
 */let a=(...e)=>e.filter((e,t,n)=>!!e&&""!==e.trim()&&n.indexOf(e)===t).join(" ").trim(),i={xmlns:"http://www.w3.org/2000/svg",width:24,height:24,viewBox:"0 0 24 24",fill:"none",stroke:"currentColor","stroke-width":2,"stroke-linecap":"round","stroke-linejoin":"round"},o=e=>{for(let t in e)if(t.startsWith("aria-")||"role"===t||"title"===t)return!0;return!1},l=(0,r.createContext)({}),d=()=>(0,r.useContext)(l),s=(0,r.forwardRef)(({color:e,size:t,width:n,height:l,strokeWidth:s,absoluteStrokeWidth:c,nonScalingStroke:u,className:h="",children:f,iconNode:k=[],icon:y={node:k,aliases:[],size:24},...p},m)=>{let{size:v=24,strokeWidth:w=2,absoluteStrokeWidth:g=!1,nonScalingStroke:x=!1,color:z="currentColor",className:Z=""}=d()??{},b=!!f||o(p),[M,_,N=[]]=/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */function(e,t={}){return function(e,t={}){let n=t.attributeNames??{},r=e=>n[e]??e,o=e.size??e.width??i.width,l=e.size??e.height??i.height,d=e.aliases?.filter(e=>"string"==typeof e&&""!==e.trim()).map(e=>`lucide-${e}`)??[],s=[...e.name?[`lucide-${e.name}`]:[],...d],c=t.className?.split(" ").filter(Boolean)??[],u=!1===t.includeDefaultClasses?a(...c):a("lucide",...s,...c),h=t.absoluteStrokeWidth?Number(t.strokeWidth??i["stroke-width"])*Number(e.size??e.width??i.width)/Number(t.size??t.width??i.width):t.strokeWidth??i["stroke-width"],f={...Object.entries(i).reduce((e,[t,n])=>(e[r(t)]=n,e),{}),..."color"in t&&t.color&&{[r("stroke")]:t.color},..."size"in t&&null!=t.size&&{[r("width")]:t.size,[r("height")]:t.size},..."width"in t&&null!=t.width&&{[r("width")]:t.width},..."height"in t&&null!=t.height&&{[r("height")]:t.height},[r("stroke-width")]:h,...u&&{[r("class")]:u},[r("viewBox")]:`0 0 ${o} ${l}`,...!1===t.hasA11yProp?{[r("aria-hidden")]:"true"}:{},..."attributes"in t&&t.attributes};return["svg",f,e.node.map(e=>{let[n,a,i]=e,o=t.nonScalingStroke?{[r("vector-effect")]:"non-scaling-stroke",...a}:a;return i?[n,o,i]:[n,o]})]}(e,{...t,attributeNames:{...t.attributeNames,class:"className","stroke-width":"strokeWidth","stroke-linecap":"strokeLinecap","stroke-linejoin":"strokeLinejoin","vector-effect":"vectorEffect"}})}(y,{color:e??z,width:n??t??v,height:l??t??v,strokeWidth:s??w,absoluteStrokeWidth:c??g,nonScalingStroke:u??x,className:a(Z,h),hasA11yProp:b,attributes:p});return(0,r.createElement)(M,{ref:m,..._},[...N.map(([e,t])=>(0,r.createElement)(e,t)),...Array.isArray(f)?f:[f]])})},2808:function(e,t,n){n.d(t,{Z:function(){return d}});var r=n(2265);/**
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
 */function(e,t,n=[]){if(null==t)throw Error("[lucide]: iconNode is required when icon name is used");return{name:a(e),size:24,node:t,...n.length>0?{aliases:n}:{}}}(e,t,n):e,d=(0,r.forwardRef)(({className:e,...t},n)=>(0,r.createElement)(l.default,{ref:n,icon:i,className:e,...t}));return i.name&&(d.displayName=o(i.name)),d}},9799:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"calendar",size:24,node:[["path",{d:"M8 2v3",key:"1ioesn"}],["path",{d:"M16 2v3",key:"otl347"}],["rect",{x:"3",y:"3",width:"18",height:"18",rx:"2",key:"h1oib"}],["path",{d:"M3 9h18",key:"1pudct"}]]};a.node;let i=(0,r.Z)(a)},6312:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"circle-check",size:24,node:[["circle",{cx:"12",cy:"12",r:"10",key:"1mglay"}],["path",{d:"m16 9-5.5 5.5L8 12",key:"xofnsj"}]],aliases:["check-circle-2"]};a.node;let i=(0,r.Z)(a)},5530:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"external-link",size:24,node:[["path",{d:"M15 3h6v6",key:"1q9fwt"}],["path",{d:"M10 14 21 3",key:"gplh6r"}],["path",{d:"M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6",key:"a6xqqp"}]]};a.node;let i=(0,r.Z)(a)},1071:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"gamepad-2",size:24,node:[["line",{x1:"6",x2:"10",y1:"11",y2:"11",key:"1gktln"}],["line",{x1:"8",x2:"8",y1:"9",y2:"13",key:"qnk9ow"}],["line",{x1:"15",x2:"15.01",y1:"12",y2:"12",key:"krot7o"}],["line",{x1:"18",x2:"18.01",y1:"10",y2:"10",key:"1lcuu1"}],["path",{d:"M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z",key:"mfqc10"}]]};a.node;let i=(0,r.Z)(a)},9105:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"image",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",ry:"2",key:"1m3agn"}],["circle",{cx:"9",cy:"9",r:"2",key:"af1f0g"}],["path",{d:"m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21",key:"1xmnt7"}]]};a.node;let i=(0,r.Z)(a)},8687:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};a.node;let i=(0,r.Z)(a)},6518:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"megaphone",size:24,node:[["path",{d:"M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z",key:"q8bfy3"}],["path",{d:"M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14",key:"1853fq"}],["path",{d:"M8 6v8",key:"15ugcq"}]]};a.node;let i=(0,r.Z)(a)},189:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"panels-top-left",size:24,node:[["rect",{width:"18",height:"18",x:"3",y:"3",rx:"2",key:"afitv7"}],["path",{d:"M3 9h18",key:"1pudct"}],["path",{d:"M9 21V9",key:"1oto5p"}]],aliases:["layout"]};a.node;let i=(0,r.Z)(a)},8247:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"plus",size:24,node:[["path",{d:"M5 12h14",key:"1ays0h"}],["path",{d:"M12 5v14",key:"s699le"}]]};a.node;let i=(0,r.Z)(a)},9809:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"save",size:24,node:[["path",{d:"M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z",key:"1c8476"}],["path",{d:"M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7",key:"1ydtos"}],["path",{d:"M7 3v4a1 1 0 0 0 1 1h7",key:"t51u73"}]]};a.node;let i=(0,r.Z)(a)},3209:function(e,t,n){n.d(t,{Z:function(){return i}});var r=n(2808);/**
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