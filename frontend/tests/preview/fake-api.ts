import {picture,vault,vaultCatalog,possibilities as samplePaths,pathComparison,mirrorCard,mirrorEmpty,adminUsage} from '../fixtures/counselor';
import type {Possibility} from '@/lib/possibilities';
export const calls:{method:string;args:unknown[]}[]=[];
// ?mirror=empty: the Mirror before it is ready (onboarding only).
const mirrorState=new URLSearchParams(location.search).get('mirror')==='empty'?mirrorEmpty:mirrorCard;
// The Paths page: a third path so Compare can take three; ?chosen=1 starts
// with the first path chosen. Choosing one puts any earlier choice back to saved.
let possibilities:Possibility[]=[...structuredClone(samplePaths),
  {id:'path-three',title:'Medicine',why:'You said you want to help people directly.',status:'suggested',evidence:[],source:'analyzer',unknowns:[],
    fit:[{label:'Biology at school',status:'blocker',note:'Your group has no biology.',evidence:['I took Pre-Engineering.']}]}];
if(new URLSearchParams(location.search).has('chosen')) possibilities[0].status='chosen';
const changePossibility=(id:string,action:string)=>{
  possibilities=possibilities.map(p=>action==='choose'?(p.id===id?{...p,status:'chosen'}:p.status==='chosen'?{...p,status:'saved'}:p)
    :p.id!==id?p:{...p,status:action==='save'?'saved':'dismissed'});
  return structuredClone(possibilities.find(p=>p.id===id)!);};
const api={getCounselorWorkspace:async()=>picture,getVault:async()=>vault,getVaultCatalog:async()=>vaultCatalog,getPossibilities:async()=>structuredClone(possibilities),
  changePossibility:async(id:string,action:string)=>changePossibility(id,action),
  comparePaths:async(ids:string[])=>({...pathComparison,paths:pathComparison.paths.filter(p=>ids.includes(p.id))}),
  getFamilyTalk:async()=>({ready:true,path_id:'path-one',path:'Practical design',message:'Prepare around what you know, without assuming that a concern has been resolved.',family:[{id:'person-one',role:'Parent',wish:'A dependable career',worry:'Whether the work will be stable',evidence:'My parent wants me to have dependable work.'}],evidence:[{id:'quote-one',quote:'I fixed a broken lamp with my friend.'}]}),
  prepareFamilyTalk:async()=>({event_id:'offline-family',script:'I understand that dependable work matters to you. I want to explore practical design. I fixed a broken lamp with my friend. I would like us to look at the evidence together before deciding.'}),
  addOwnPath:async()=>({...possibilities[1],id:'own-path',title:'Nursing',why:'Nursing',source:'student',status:'saved',fit:[]}),
  getCounselorHealth:async()=>({planner_lag_alert:false}),
  // The preview signs in as a founder, so Settings shows the spend card.
  getAdminUsage:async()=>structuredClone(adminUsage),
  getMirror:async()=>structuredClone(mirrorState),
  getStudentRequests:async()=>[],
  getCounselorRequests:async()=>[],getOperatorRun:async()=>null,
  loadMessageHistory:async()=>({events:[]}),pollMessages:async()=>({messages:[]}),
  answerFactCard:async()=>({saved:true}),
  addVaultEntry:async()=>({saved:true}),editVaultEntry:async()=>({saved:true}),confirmVaultEntry:async()=>({saved:true}),removeVaultEntry:async()=>({saved:true}),resolveVaultConflict:async()=>({resolved:true}),
  submitOnboarding:async()=>({completed:true,rejected:{},saved:[]}),
  listShares:async()=>[{id:'share-1',workspaceId:'offline',channelName:'pai-counselor',title:'My conversation with PAI',shareToken:'offline-token',messageCount:12,status:'active',createdAt:'2026-10-18T09:00:00Z'}],
};
// ?state=loading|error|empty forces every read into that state for review.
const forced=new URLSearchParams(location.search).get('state');
const emptyReads:Record<string,unknown>={
  getCounselorWorkspace:{coverage:Object.fromEntries(Object.keys(picture.coverage).map(k=>[k,{covered:false,item_count:0,evidence:null}])),
    personal:{world:{},self:[],source:[],pressures:{items:[]},sure:{score:null,history:[]}},capabilities:[],academic:{records:{}},sections:{},
    picture:{header:{name:null,education_line:null},unknowns:[],text:null,ready:false,version:'v0'},moments:{},ratings:[]},
  getVault:{details:{},story:[],conflicts:[],stale:[]},getPossibilities:[],getMirror:{...mirrorEmpty,header:{name:null,education_line:null},areas:mirrorEmpty.areas.map(a=>({...a,level:0,entries:[]})),
    unknowns:mirrorCard.areas.map((a,i)=>({area:a.key,label:a.label,question_key:`topic_text.${a.key}`,priority:i+1}))},
};
const read=(method:string)=>method.startsWith('get')&&method!=='getCounselorHealth'&&method!=='getFileUrl';
export const workspaceApi=new Proxy(api,{get:(target,key)=>{const method=String(key);return (...args:unknown[])=>{calls.push({method,args});
  if(forced&&read(method)){
    if(forced==='loading') return new Promise(()=>{});
    if(forced==='error') return Promise.reject(new Error('Offline review: forced error'));
    if(forced==='empty'&&method in emptyReads) return Promise.resolve(structuredClone(emptyReads[method]));
  }
  const fn=target[key as keyof typeof target] as ((...a:unknown[])=>Promise<unknown>)|undefined;return fn?fn(...args):Promise.resolve([]);};}}) as any;
(window as any).__offlineCalls=calls;
