(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[2508],{601:function(e,t,n){Promise.resolve().then(n.bind(n,4013)),Promise.resolve().then(n.bind(n,7394)),Promise.resolve().then(n.t.bind(n,4724,23))},4013:function(e,t,n){"use strict";n.r(t),n.d(t,{default:function(){return i}});var r=n(7437),a=n(2265),s=n(8687);function i(e){let{id:t,name:n,is_active:i}=e,[l,o]=(0,a.useState)(i),[c,u]=(0,a.useState)(!1),[f,d]=(0,a.useState)(null),p=async()=>{u(!0),d(null);try{var e;let n=await fetch("/api/games",{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:t,is_active:!l})}),r=await n.json();if(!n.ok){d(r.error||"Request failed (".concat(n.status,")"));return}o(null!==(e=r.is_active)&&void 0!==e?e:!l)}catch(e){d(e instanceof Error?e.message:"Unable to reach the server. Please try again.")}finally{u(!1)}};return(0,r.jsxs)("div",{className:"flex flex-col items-start gap-1",children:[(0,r.jsxs)("div",{className:"flex items-center gap-2",children:[(0,r.jsx)("span",{className:"text-[10px] font-bold uppercase tracking-wider ".concat(l?"text-emerald-300":"text-slate-500"),children:l?"ACTIVE":"DISABLED"}),(0,r.jsxs)("button",{onClick:p,disabled:c,role:"switch","aria-checked":l,"aria-label":"Toggle ".concat(n," visibility"),className:"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition ".concat(l?"bg-emerald-500/80":"bg-slate-600/60"," disabled:opacity-50"),children:[c&&(0,r.jsx)(s.Z,{size:11,className:"absolute left-1/2 -translate-x-1/2 animate-spin text-white"}),!1===c&&(0,r.jsx)("span",{className:"inline-block h-3.5 w-3.5 transform rounded-full bg-white transition ".concat(l?"translate-x-5":"translate-x-1")})]})]}),f&&(0,r.jsx)("p",{className:"text-[10px] text-rose-400",children:f})]})}},622:function(e,t,n){"use strict";/**
 * @license React
 * react-jsx-runtime.production.min.js
 *
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */var r=n(2265),a=Symbol.for("react.element"),s=Symbol.for("react.fragment"),i=Object.prototype.hasOwnProperty,l=r.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,o={key:!0,ref:!0,__self:!0,__source:!0};function c(e,t,n){var r,s={},c=null,u=null;for(r in void 0!==n&&(c=""+n),void 0!==t.key&&(c=""+t.key),void 0!==t.ref&&(u=t.ref),t)i.call(t,r)&&!o.hasOwnProperty(r)&&(s[r]=t[r]);if(e&&e.defaultProps)for(r in t=e.defaultProps)void 0===s[r]&&(s[r]=t[r]);return{$$typeof:a,type:e,key:c,ref:u,props:s,_owner:l.current}}t.Fragment=s,t.jsx=c,t.jsxs=c},7437:function(e,t,n){"use strict";e.exports=n(622)},2808:function(e,t,n){"use strict";n.d(t,{Z:function(){return o}});var r=n(2265);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a=e=>e?.replace(/([a-z0-9])([A-Z])/g,"$1-$2").toLowerCase(),s=e=>{let t="",n=!1;for(let r of e){if("-"===r||"_"===r||r<=" "){n=t.length>0;continue}0===t.length?t+=r.toLowerCase():t+=n?r.toUpperCase():r,n=!1}return t},i=e=>{let t=s(e);return t.charAt(0).toUpperCase()+t.slice(1)};var l=n(7394);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */function o(e,t=[],n=[]){let s="string"==typeof e?/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */function(e,t,n=[]){if(null==t)throw Error("[lucide]: iconNode is required when icon name is used");return{name:a(e),size:24,node:t,...n.length>0?{aliases:n}:{}}}(e,t,n):e,o=(0,r.forwardRef)(({className:e,...t},n)=>(0,r.createElement)(l.default,{ref:n,icon:s,className:e,...t}));return s.name&&(o.displayName=i(s.name)),o}},8687:function(e,t,n){"use strict";n.d(t,{Z:function(){return s}});var r=n(2808);/**
 * @license lucide-react v1.48.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */let a={name:"loader-circle",size:24,node:[["path",{d:"M21 12a9 9 0 1 1-6.219-8.56",key:"13zald"}]],aliases:["loader-2"]};a.node;let s=(0,r.Z)(a)}},function(e){e.O(0,[855,2971,7864,1744],function(){return e(e.s=601)}),_N_E=e.O()}]);