
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const defaults={threshold:60,minGrade:1,passGrade:4,maxGrade:7};
const parse=(x,f)=>{try{return JSON.parse(x)}catch{return f}};
const store={get(k,f){try{return localStorage.getItem(k)??f}catch{return f}},set(k,v){try{localStorage.setItem(k,v)}catch{}}};
const APP_SCHEMA_VERSION=2;
const DB_KEY='omr_app_db_v1';
function legacyDatabase(){
  return {
    schemaVersion:APP_SCHEMA_VERSION,
    meta:{createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
    settings:{...defaults,...parse(store.get('omr4_settings','{}'),{})},
    years:parse(store.get('omr4_years','[]'),[]),
    courses:parse(store.get('omr4_courses','[]'),[]),
    students:parse(store.get('omr4_students','[]'),[]),
    evaluations:parse(store.get('omr4_evaluations','[]'),[]),
    review:parse(store.get('omr4_review','[]'),[]),
    results:parse(store.get('omr4_results','[]'),[]),activity:parse(store.get('omr4_activity','[]'),[]),persons:parse(store.get('omr4_persons','[]'),[]),enrollments:parse(store.get('omr4_enrollments','[]'),[])
  };
}
function loadDatabase(){
  const raw=parse(store.get(DB_KEY,'null'),null);
  if(raw&&typeof raw==='object'&&Array.isArray(raw.courses)&&Array.isArray(raw.evaluations)){
    raw.schemaVersion=Number(raw.schemaVersion)||APP_SCHEMA_VERSION;
    raw.meta=raw.meta||{createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    raw.settings={...defaults,...(raw.settings||{})};
    raw.years=Array.isArray(raw.years)?raw.years:[];
    raw.students=Array.isArray(raw.students)?raw.students:[];
    raw.review=Array.isArray(raw.review)?raw.review:[];
    raw.results=Array.isArray(raw.results)?raw.results:[];
    raw.activity=Array.isArray(raw.activity)?raw.activity:[];
    raw.persons=Array.isArray(raw.persons)?raw.persons:[];
    raw.enrollments=Array.isArray(raw.enrollments)?raw.enrollments:[];
    return raw;
  }
  return legacyDatabase();
}
const db=loadDatabase();

const EVIDENCE_DB='omr_evidence_v1';
const EVIDENCE_STORE='images';
function openEvidenceDB(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window))return reject(new Error('IndexedDB no disponible'));
    const req=indexedDB.open(EVIDENCE_DB,1);
    req.onupgradeneeded=()=>{const d=req.result;if(!d.objectStoreNames.contains(EVIDENCE_STORE))d.createObjectStore(EVIDENCE_STORE)};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error('No se pudo abrir almacenamiento de evidencias'));
  });
}
async function evidencePut(key,blob){
  if(!key||!blob)return false;
  try{
    const d=await openEvidenceDB();
    await new Promise((resolve,reject)=>{
      const tx=d.transaction(EVIDENCE_STORE,'readwrite');
      tx.objectStore(EVIDENCE_STORE).put(blob,key);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    d.close();return true;
  }catch(err){console.warn('Evidencia no persistida:',err);return false}
}
async function evidenceGet(key){
  if(!key)return null;
  try{
    const d=await openEvidenceDB();
    const blob=await new Promise((resolve,reject)=>{
      const tx=d.transaction(EVIDENCE_STORE,'readonly');
      const req=tx.objectStore(EVIDENCE_STORE).get(key);
      req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error);
    });
    d.close();return blob;
  }catch(err){console.warn('No se pudo leer evidencia:',err);return null}
}
async function evidenceDelete(key){
  if(!key)return;
  try{
    const d=await openEvidenceDB();
    await new Promise((resolve,reject)=>{
      const tx=d.transaction(EVIDENCE_STORE,'readwrite');
      tx.objectStore(EVIDENCE_STORE).delete(key);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
    d.close();
  }catch(err){console.warn('No se pudo borrar evidencia:',err)}
}

async function evidenceKeys(){
  try{
    const d=await openEvidenceDB();
    const keys=await new Promise((resolve,reject)=>{
      const tx=d.transaction(EVIDENCE_STORE,'readonly');
      const req=tx.objectStore(EVIDENCE_STORE).getAllKeys();
      req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);
    });
    d.close();return keys;
  }catch(err){console.warn('No se pudieron listar evidencias:',err);return []}
}
function blobToDataURL(blob){
  return new Promise((resolve,reject)=>{
    const fr=new FileReader();
    fr.onload=()=>resolve(fr.result);fr.onerror=()=>reject(fr.error);
    fr.readAsDataURL(blob);
  });
}
function dataURLToBlob(dataURL){
  const [meta,data]=String(dataURL).split(',');
  const mime=(meta.match(/data:([^;]+)/)||[])[1]||'application/octet-stream';
  const bin=atob(data),arr=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)arr[i]=bin.charCodeAt(i);
  return new Blob([arr],{type:mime});
}
function setBackupProgress(text,show=true){
  const el=$('#backupProgress');if(!el)return;
  el.classList.toggle('hidden',!show);
  el.innerHTML=text;
}


const state={schemaVersion:db.schemaVersion||APP_SCHEMA_VERSION,meta:db.meta||{},settings:db.settings,years:db.years,courses:db.courses,students:db.students,persons:db.persons||[],enrollments:db.enrollments||[],evaluations:db.evaluations,review:db.review,results:db.results,activity:db.activity||[],queue:[],scanPages:[],editingId:null,editingForm:null,activeCourseId:null};
const currentYear=new Date().getFullYear();
let resultsScope='course';
const scoringUnlocked=new Set();
const pendingAnswerReviews={};
if(!state.years.length)state.years=[{year:currentYear,start:`${currentYear}-03-01`,vacStart:`${currentYear}-07-13`,vacEnd:`${currentYear}-07-26`,end:`${currentYear}-12-04`}];
function uid(){return crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)}
function databaseSnapshot(){
  return {
    schemaVersion:APP_SCHEMA_VERSION,
    meta:{createdAt:state.meta?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()},
    settings:state.settings,years:state.years,courses:state.courses,students:state.students,persons:state.persons,enrollments:state.enrollments,
    evaluations:state.evaluations,review:state.review,results:state.results,activity:state.activity
  };
}
function persist(){
  const snap=databaseSnapshot();
  state.schemaVersion=snap.schemaVersion;state.meta=snap.meta;
  store.set(DB_KEY,JSON.stringify(snap));
  // Espejo temporal para mantener compatibilidad con respaldos/prototipos anteriores.
  store.set('omr4_settings',JSON.stringify(state.settings));store.set('omr4_years',JSON.stringify(state.years));
  store.set('omr4_courses',JSON.stringify(state.courses));store.set('omr4_students',JSON.stringify(state.students));
  store.set('omr4_evaluations',JSON.stringify(state.evaluations));store.set('omr4_review',JSON.stringify(state.review));
  store.set('omr4_results',JSON.stringify(state.results));store.set('omr4_activity',JSON.stringify(state.activity));store.set('omr4_persons',JSON.stringify(state.persons));store.set('omr4_enrollments',JSON.stringify(state.enrollments));
  const ss=$('#saveState');if(ss)ss.innerHTML='<span class="ok-dot"></span>Guardado local';
}

function logActivity(type,detail='',meta={}){
  state.activity=Array.isArray(state.activity)?state.activity:[];
  state.activity.unshift({id:uid(),at:new Date().toISOString(),type,detail,meta});
  if(state.activity.length>500)state.activity=state.activity.slice(0,500);
}
function activityLabel(type){
  return ({
    scan_saved:'Escaneo guardado',
    scan_deleted:'Escaneo eliminado',
    identity_changed:'Identificación modificada',
    answer_reviewed:'Respuesta revisada',
    evaluation_archived:'Evaluación archivada',
    evaluation_restored:'Evaluación restaurada',
    scoring_unlocked:'Pauta desbloqueada',
    scoring_changed:'Pauta modificada',
    backup_imported:'Respaldo importado',school_year_added:'Calendario agregado',school_year_deleted:'Calendario eliminado',school_year_saved:'Calendario actualizado',enrollment_imported:'Estudiante agregado',student_removed:'Estudiante eliminado del curso',course_deleted:'Curso eliminado'
  })[type]||type;
}
function activityForEvaluation(eid,limit=30){
  return (state.activity||[]).filter(a=>a.meta?.evaluationId===eid).slice(0,limit);
}

function esc(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function fmt(n,d=1){return Number(n||0).toLocaleString('es-CL',{minimumFractionDigits:d,maximumFractionDigits:d})}
function dateCL(v){if(!v)return 'Sin fecha';const [y,m,d]=v.split('-').map(Number);return new Date(y,m-1,d).toLocaleDateString('es-CL',{day:'2-digit',month:'short',year:'numeric'})}
function monthKey(v){return v?v.slice(0,7):'sin-fecha'}
function courseName(c){return c?`${c.level} ${c.letter} · ${c.subject}`:'Sin curso'}
function courseById(id){return state.courses.find(c=>c.id===id)}
function evalById(id){return state.evaluations.find(e=>e.id===id)}
function defaultOptionsFor(ev){
  const n=Math.max(2,Math.min(5,Number(ev?.choices)||4));
  return Array.from({length:n},(_,i)=>String.fromCharCode(65+i));
}
function cloneItems(items,ev=null){return items.map((q,i)=>{
  const opts=Array.isArray(q.options)&&q.options.length>=2?q.options.slice():defaultOptionsFor(ev);
  let key=q.key||opts[0]||'A'; if(!opts.includes(key))key=opts[0]||'A';
  return {n:i+1,itemId:q.itemId||`I${String(i+1).padStart(3,'0')}`,key,points:Number(q.points??1),active:q.active!==false,skill:q.skill||'',content:q.content||'',options:opts}
})}
function makeBaseItems(count,ev=null){const opts=defaultOptionsFor(ev);return Array.from({length:Math.max(1,Number(count)||1)},(_,i)=>({n:i+1,itemId:`I${String(i+1).padStart(3,'0')}`,key:opts[0]||'A',points:1,active:true,skill:'',content:'',options:opts.slice()}))}
function ensureEvaluationQuestions(ev){
  if(!ev)return;
  ev.forms=Array.isArray(ev.forms)&&ev.forms.length?ev.forms:['Única'];
  ev.formConfigs=ev.formConfigs||{};
  const initial=Math.max(1,Number(ev.questions)||1);
  ev.forms.forEach(f=>{
    const raw=ev.formConfigs[f];
    if(!raw || !Array.isArray(raw.items) || !raw.items.length){
      ev.formConfigs[f]={items:makeBaseItems(initial,ev)};
    }else{
      ev.formConfigs[f]={...raw,items:cloneItems(raw.items,ev)};
    }
  });
  // ev.questions queda como cantidad inicial/de referencia, no obliga a todas las formas.
  ev.questions=Math.max(1,Number(ev.questions)||Math.max(...ev.forms.map(f=>ev.formConfigs[f].items.length),1));
}

function personRunKey(run){return normalizeRunText(run||'')}
function personById(id){return state.persons.find(p=>p.id===id)||null}
function enrollmentByStudentId(studentId){return state.enrollments.find(e=>e.studentId===studentId)||null}
function enrollmentsForPerson(personId){return state.enrollments.filter(e=>e.personId===personId)}
function ensurePersonForStudent(s){
  if(!s)return null;
  let p=s.personId?personById(s.personId):null;
  if(!p){
    // Migración conservadora: un registro antiguo obtiene identidad propia.
    // La vinculación con otro año por RUN se hace solo con confirmación del usuario.
    p={id:uid(),run:s.run||'',firstName:s.firstName||'',lastName:s.lastName||'',createdAt:new Date().toISOString(),migrationCreated:true};
    state.persons.push(p);
  }else{
    if(!p.run&&s.run)p.run=s.run;
    if(!p.firstName&&s.firstName)p.firstName=s.firstName;
    if(!p.lastName&&s.lastName)p.lastName=s.lastName;
  }
  s.personId=p.id;
  let enr=enrollmentByStudentId(s.id);
  if(!enr){
    const course=courseById(s.courseId);
    enr={id:uid(),personId:p.id,courseId:s.courseId,studentId:s.id,year:course?.year||null,status:'active',createdAt:new Date().toISOString()};
    state.enrollments.push(enr);
  }else{
    enr.personId=p.id;
    const course=courseById(s.courseId);
    enr.courseId=s.courseId;
    enr.year=course?.year||enr.year||null;
  }
  s.enrollmentId=enr.id;
  return p;
}
function createRosterStudent(person,courseId){
  const existing=state.students.find(s=>s.courseId===courseId&&s.personId===person.id);
  if(existing)return existing;
  const s={id:uid(),courseId,personId:person.id,run:person.run||'',firstName:person.firstName||'',lastName:person.lastName||''};
  state.students.push(s);
  const course=courseById(courseId);
  const enr={id:uid(),personId:person.id,courseId,studentId:s.id,year:course?.year||null,status:'active',createdAt:new Date().toISOString()};
  state.enrollments.push(enr);s.enrollmentId=enr.id;
  return s;
}
function findOrCreatePerson(run,first,last){
  const key=personRunKey(run);
  let p=key?state.persons.find(x=>personRunKey(x.run)===key):null;
  if(!p){
    p={id:uid(),run:run||'',firstName:first||'',lastName:last||'',createdAt:new Date().toISOString()};
    state.persons.push(p);
  }else{
    if(first)p.firstName=first;
    if(last)p.lastName=last;
    if(run)p.run=run;
  }
  return p;
}

function peopleByRun(run){
  const key=personRunKey(run);
  if(!key)return [];
  return state.persons.filter(p=>personRunKey(p.run)===key)
    .sort((a,b)=>enrollmentsForPerson(b.id).length-enrollmentsForPerson(a.id).length);
}
function personHistorySummary(person){
  if(!person)return {enrollments:[],resultCount:0,text:'Sin historial'};
  const ens=enrollmentsForPerson(person.id).slice().sort((a,b)=>(b.year||0)-(a.year||0));
  const studentIds=new Set(state.students.filter(s=>s.personId===person.id).map(s=>s.id));
  const resultCount=(state.results||[]).filter(r=>studentIds.has(r.omr?.studentMatch?.studentId)).length;
  const text=ens.map(e=>{
    const c=courseById(e.courseId);
    return `${e.year||c?.year||'—'} · ${courseName(c)}`;
  }).join(' · ');
  return {enrollments:ens,resultCount,text:text||'Sin matrículas previas'};
}
function createIndependentPerson(run,first,last){
  const p={id:uid(),run:run||'',firstName:first||'',lastName:last||'',createdAt:new Date().toISOString(),separateHistory:true};
  state.persons.push(p);return p;
}
function bestExistingPersonByRun(run){
  return peopleByRun(run)[0]||null;
}

function migrate(){
  state.persons=Array.isArray(state.persons)?state.persons:[];
  state.enrollments=Array.isArray(state.enrollments)?state.enrollments:[];
  state.students=Array.isArray(state.students)?state.students:[];
  state.students.forEach(s=>ensurePersonForStudent(s));
  state.evaluations.forEach(ev=>{ev.type=ev.type||'sumativa';ev.status=ev.status||'configurada';ev.archived=ev.archived===true;ev.unit=ev.unit||'';ev.objective=ev.objective||'';ev.date=ev.date||'';ev.forms=ev.forms?.length?ev.forms:['Única'];ev.grading=ev.grading||{...state.settings};if(!ev.questions){ev.questions=Math.max(...ev.forms.map(f=>ev.formConfigs?.[f]?.items?.length||0),1)}ensureEvaluationQuestions(ev)})
}
migrate();persist();
const meta={dashboard:['Inicio','Gestión de evaluaciones, cursos y lectura OMR.'],courses:['Cursos','Estudiantes e historial de evaluaciones por año.'],calendar:['Calendario','Agenda simple de evaluaciones asociadas al lector.'],evaluations:['Evaluaciones','Configuración pedagógica, formas, claves y puntajes.'],scan:['Importar / Escanear','Carga por lote de hojas y PDF.'],settings:['Configuración','Año escolar y valores predeterminados.'],results:['Resultados','Análisis de desempeño de evaluaciones escaneadas.']};
function showView(v,preserveEditor=false){$$('.view').forEach(x=>x.classList.toggle('active',x.id===v));$$('.nav button').forEach(x=>x.classList.toggle('active',x.dataset.view===v));$('#viewTitle').textContent=meta[v][0];$('#viewSubtitle').textContent=meta[v][1];if(v==='dashboard')renderDashboard();if(v==='courses')renderCourses();if(v==='calendar')renderCalendar();if(v==='evaluations'){if(!preserveEditor)closeEditor();renderEvaluations()}if(v==='scan')renderScan();if(v==='results')renderResults();if(v==='settings')renderSettings();renderStats()}


function compactOMRForStorage(o){
  if(!o)return null;
  const copy=JSON.parse(JSON.stringify(o));
  delete copy.runCrop;
  delete copy.markers;
  (copy.answers||[]).forEach(a=>{delete a.crop;delete a.scores});
  return copy;
}

function duplicateStudentResult(o,excludeKey=null){
  const sid=o?.studentMatch?.studentId;
  if(!sid||!o?.evaluationId)return null;
  return (state.results||[]).find(r=>
    r.key!==excludeKey &&
    r.evaluationId===o.evaluationId &&
    r.omr?.studentMatch?.studentId===sid
  )||null;
}

function resultKeyForPage(p,o){
  return `${o.evaluationId}::${p.sourceName||p.label}::${p.page||0}::${p.label}`;
}
async function savePageResult(page){
  const o=page?.omr;if(!o?.ok||!o.evaluationId)return;
  const key=resultKeyForPage(page,o);
  const duplicate=duplicateStudentResult(o,key);
  const rec={
    id:key,key,evidenceKey:key,evaluationId:o.evaluationId,label:page.label,sourceName:page.sourceName||page.label,
    page:page.page||null,kind:page.kind||'',savedAt:new Date().toISOString(),duplicateOf:duplicate?.key||null,omr:compactOMRForStorage(o)
  };
  const i=state.results.findIndex(x=>x.key===key);
  const existed=i>=0;
  if(existed)state.results[i]=rec; else state.results.push(rec);
  if(!existed)logActivity('scan_saved',`${page.label} · ${o.studentMatch?.name||o.studentMatch?.run||'Sin identificar'}`,{evaluationId:o.evaluationId,resultKey:key,studentId:o.studentMatch?.studentId||null});
  if(duplicate && !state.review.some(r=>r.type==='Posible duplicado'&&r.file===page.label)){
    state.review.push({id:uid(),source:'omr',type:'Posible duplicado',file:page.label,detail:`Ya existe un escaneo para ${o.studentMatch?.name||o.studentMatch?.run||'este estudiante'} en esta evaluación. Revisa cuál conservar.`,resultKey:key,duplicateKey:duplicate.key});
  }
  persist();
  await saveCorrectionEvidence(page,key);
}
function updateStoredResultFromPage(page){
  const key=page?.omr?resultKeyForPage(page,page.omr):null;
  if(!key||!state.results.some(r=>r.key===key))return;
  savePageResult(page);
}

function recalcStoredResultsForEvaluation(eid){
  const ev=state.evaluations.find(e=>e.id===eid);if(!ev)return;
  (state.results||[]).forEach(rec=>{
    if(rec.evaluationId!==eid||!rec.omr?.ok)return;
    const form=rec.omr.form||ev.forms?.[0];
    const cfg=ev.formConfigs?.[form]||ev.formConfigs?.[ev.forms?.[0]];
    if(!cfg?.items)return;
    let earned=0,max=0;
    cfg.items.forEach((q,i)=>{
      if(q.active===false)return;
      const pts=Math.max(0,Number(q.points)||0);max+=pts;
      const ans=rec.omr.answers?.[i]?.answer||'';
      if(ans&&ans===String(q.key||'').toUpperCase())earned+=pts;
    });
    rec.omr.score={earned,max};
  });
}

function resultRowsForEvaluation(eid){
  const ev=state.evaluations.find(e=>e.id===eid); if(!ev)return [];
  return (state.results||[]).filter(p=>p.omr?.ok && p.evaluationId===eid).map(p=>{
    const o=p.omr,student=o.studentMatch?.studentId?state.students.find(s=>s.id===o.studentMatch.studentId):null;
    const form=o.form||ev.forms?.[0]||'';
    const cfg=ev.formConfigs?.[form]||ev.formConfigs?.[ev.forms?.[0]];
    const max=o.score?.max??getMax(ev,form);
    const earned=o.score?.earned??0;
    const percent=max>0?earned/max*100:0;
    const g=ev.type==='sumativa'?grade(earned,ev,form):null;
    return {page:p,omr:o,student,form,cfg,earned,max,percent,grade:g};
  });
}
function resultStudentName(r){
  if(r.student)return `${r.student.lastName||''} ${r.student.firstName||''}`.trim();
  if(r.omr?.studentMatch?.name)return r.omr.studentMatch.name;
  return 'Sin identificar';
}
function fillResultsEvaluation(){
  const sel=$('#resultsEvaluation'); if(!sel)return;
  const old=sel.value;
  const evals=state.evaluations.slice().sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  sel.innerHTML='<option value="">Selecciona una evaluación</option>'+evals.map(e=>`<option value="${e.id}">${esc(e.name)} — ${esc(courseName(courseById(e.courseId)))}</option>`).join('');
  if(old&&evals.some(e=>e.id===old))sel.value=old;
  else{
    const scanned=[...new Set((state.results||[]).filter(p=>p.omr?.evaluationId).map(p=>p.omr.evaluationId))];
    if(scanned.length)sel.value=scanned[0];
  }
}

function fillResultsForm(ev,rows){
  const sel=$('#resultsForm'); if(!sel)return;
  const old=sel.value;
  const forms=[...new Set(rows.map(r=>r.form).filter(Boolean))];
  sel.innerHTML='<option value="">General</option>'+forms.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('');
  if(old && forms.includes(old))sel.value=old;
}

function fillResultsStudent(rows){
  const wrap=$('#resultsStudentWrap'),sel=$('#resultsStudent'); if(!wrap||!sel)return;
  wrap.classList.toggle('hidden',resultsScope!=='student');
  if(resultsScope!=='student')return;
  const old=sel.value;
  const identified=rows.filter(r=>r.student).slice().sort((a,b)=>resultStudentName(a).localeCompare(resultStudentName(b),'es'));
  sel.innerHTML=identified.length?identified.map(r=>`<option value="${r.student.id}">${esc(resultStudentName(r))}</option>`).join(''):'<option value="">Sin estudiantes identificados</option>';
  if(old&&identified.some(r=>r.student.id===old))sel.value=old;
}

function renderEvaluationActivity(eid){
  const box=$('#evaluationActivity');if(!box)return;
  if(!eid){box.innerHTML='';return}
  const rows=activityForEvaluation(eid,20);
  box.innerHTML=`<article class="panel" style="margin-top:14px">
    <div class="panel-head">
      <div><h3>Registro de actividad</h3><p>Cambios registrados desde la versión 0.27 para esta evaluación.</p></div>
    </div>
    ${rows.length?`<div class="audit-list">${rows.map(a=>`<div class="audit-item">
      <div class="top"><strong>${esc(activityLabel(a.type))}</strong><span class="time">${new Date(a.at).toLocaleString('es-CL')}</span></div>
      <div class="detail">${esc(a.detail||'')}</div>
    </div>`).join('')}</div>`:
    `<div class="empty">Todavía no hay actividad registrada para esta evaluación. Los escaneos y cambios realizados antes de la v0.27 no se reconstruyen retroactivamente.</div>`}
  </article>`;
}

function renderResults(){
  fillResultsEvaluation();
  const eid=$('#resultsEvaluation')?.value||'';
  const ev=state.evaluations.find(e=>e.id===eid);
  const allRows=eid?resultRowsForEvaluation(eid):[];
  fillResultsForm(ev,allRows);
  const selectedForm=$('#resultsForm')?.value||'';
  const formRows=selectedForm?allRows.filter(r=>r.form===selectedForm):allRows;
  fillResultsStudent(formRows);
  const summary=$('#resultsSummary'),body=$('#resultsBody');
  $('#resultScopeStudent')?.classList.toggle('primary',resultsScope==='student');
  $('#resultScopeStudent')?.classList.toggle('secondary',resultsScope!=='student');
  $('#resultScopeCourse')?.classList.toggle('primary',resultsScope==='course');
  $('#resultScopeCourse')?.classList.toggle('secondary',resultsScope!=='course');
  $('#printStudentReports')?.classList.toggle('hidden',resultsScope!=='student');
  $('#printCourseReport')?.classList.toggle('hidden',resultsScope!=='course');

  if(!ev){
    summary.innerHTML='';
    body.innerHTML='<div class="empty">Selecciona una evaluación que tenga hojas escaneadas.</div>';
    if($('#courseAnalysisPreview'))$('#courseAnalysisPreview').innerHTML='';if($('#evaluationActivity'))$('#evaluationActivity').innerHTML='';
    return;
  }

  let rows=formRows;
  if(resultsScope==='student'){
    const sid=$('#resultsStudent')?.value||'';
    rows=allRows.filter(r=>r.student?.id===sid);
  }

  if(!rows.length){
    summary.innerHTML='';
    body.innerHTML=`<div class="empty">${resultsScope==='student'?'Selecciona un estudiante identificado.':'Esta evaluación todavía no tiene resultados guardados.'}</div>`;
    if($('#courseAnalysisPreview'))$('#courseAnalysisPreview').innerHTML='';
    return;
  }

  if(resultsScope==='course'){
    const avgPct=rows.reduce((s,r)=>s+r.percent,0)/rows.length;
    const graded=rows.filter(r=>r.grade!==null);
    const avgGrade=graded.length?graded.reduce((s,r)=>s+r.grade,0)/graded.length:null;
    const passed=ev.type==='sumativa'?graded.filter(r=>r.grade>=Number(ev.grading.passGrade||4)).length:0;
    summary.innerHTML=`
      <div class="mini"><span>Estudiantes evaluados</span><strong>${rows.length}</strong></div>
      <div class="mini"><span>Logro promedio</span><strong>${avgPct.toFixed(1)}%</strong></div>
      <div class="mini"><span>${ev.type==='sumativa'?'Nota promedio':'Tipo'}</span><strong>${ev.type==='sumativa'?(avgGrade===null?'—':avgGrade.toFixed(1)):'Formativa'}</strong></div>
      <div class="mini"><span>${ev.type==='sumativa'?'Aprobación':'Identificados'}</span><strong>${ev.type==='sumativa'?(graded.length?Math.round(passed/graded.length*100)+'%':'—'):rows.filter(r=>r.student).length+'/'+rows.length}</strong></div>
      <div class="mini"><span>Forma</span><strong>${esc(selectedForm||'General')}</strong></div>`;
  }else{
    const r=rows[0];
    summary.innerHTML=`
      <div class="mini"><span>Estudiante</span><strong style="font-size:15px">${esc(resultStudentName(r))}</strong></div>
      <div class="mini"><span>Forma</span><strong>${esc(r.form||'—')}</strong></div>
      <div class="mini"><span>Puntaje</span><strong>${r.earned.toFixed(1)} / ${r.max.toFixed(1)}</strong></div>
      <div class="mini"><span>Logro</span><strong>${r.percent.toFixed(1)}%</strong></div>
      <div class="mini"><span>${ev.type==='sumativa'?'Nota':'Tipo'}</span><strong>${ev.type==='sumativa'?(r.grade?.toFixed(1)??'—'):'Formativa'}</strong></div>`;
  }

  const mode=$('#resultsViewMode')?.value||'summary';
  if(mode==='questions')renderQuestionResults(ev,rows,body);
  else if(mode==='skills')renderTagResults(ev,rows,body,'skill','Habilidad');
  else if(mode==='contents')renderTagResults(ev,rows,body,'content','Contenido');
  else if(resultsScope==='student')renderStudentSummary(ev,rows[0],body);
  else renderCourseSummary(ev,rows,body);

  if(resultsScope==='course')renderCourseAnalysisPreview(ev,rows);
  else if($('#courseAnalysisPreview'))$('#courseAnalysisPreview').innerHTML='';
  renderEvaluationActivity(ev.id);
}

function resultRecordByKey(key){return state.results.find(r=>r.key===key||r.id===key)}
function resultCourseStudents(rec){
  const ev=state.evaluations.find(e=>e.id===rec?.evaluationId);
  return state.students.filter(s=>s.courseId===ev?.courseId).slice()
    .sort((a,b)=>`${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`,'es'));
}
async function openResultIdentityReview(resultKey){
  const rec=resultRecordByKey(resultKey);if(!rec)return alert('No se encontró este resultado.');
  const ev=state.evaluations.find(e=>e.id===rec.evaluationId);
  const students=resultCourseStudents(rec);
  const currentId=rec.omr?.studentMatch?.studentId||'';
  const raw=rec.omr?.rawRun||rec.omr?.run||'';
  const box=$('#resultIdentityContent');
  box.innerHTML=`<div class="review-fields">
    <div class="review-readout">
      <div><span>Evaluación</span><strong>${esc(ev?.name||'—')}</strong></div>
      <div><span>Lectura del RUN</span><strong>${esc(raw||'Sin lectura')}</strong></div>
    </div>
    <label>Estudiante correcto
      <select id="resultIdentityStudent">
        <option value="">— Seleccionar estudiante —</option>
        ${students.map(s=>`<option value="${s.id}" ${s.id===currentId?'selected':''}>${esc(`${s.lastName||''} ${s.firstName||''}`.trim())} · ${esc(s.run||'Sin RUN')}</option>`).join('')}
      </select>
    </label>
    <label>RUN manual (opcional)
      <input id="resultIdentityRun" value="${esc(rec.omr?.studentMatch?.run||'')}" placeholder="Ej. 23.366.610-6">
    </label>
    <div class="evidence-actions">
      <button class="secondary small" onclick="showCorrectionEvidence('${rec.key}')">Ver hoja corregida</button>
    </div>
    <div class="review-note">Esta revisión funciona aunque el lote original ya se haya vaciado. La asignación actual del resultado será reemplazada solo al guardar.</div>
    <div class="actions">
      <button class="secondary" data-close="resultIdentityModal">Cancelar</button>
      <button class="primary" onclick="saveResultIdentity('${rec.key}')">Guardar identificación</button>
    </div>
  </div>`;
  openModal('resultIdentityModal');
}
function saveResultIdentity(resultKey){
  const rec=resultRecordByKey(resultKey);if(!rec)return;
  const ev=state.evaluations.find(e=>e.id===rec.evaluationId);
  const sid=$('#resultIdentityStudent')?.value||'';
  const typed=$('#resultIdentityRun')?.value||'';
  let student=sid?state.students.find(s=>s.id===sid):null;
  if(!student&&typed)student=findStudentByManualRun(ev?.courseId,typed);
  if(!student&&!typed)return alert('Selecciona un estudiante o ingresa un RUN manual.');

  if(student){
    rec.omr.run=runForTemplate(student.run);
    rec.omr.studentMatch={exact:true,distance:0,studentId:student.id,run:student.run,
      name:`${student.firstName||''} ${student.lastName||''}`.trim()||student.run,manual:true};
    rec.omr.runIssues=[];
  }else{
    rec.omr.run=runForTemplate(typed);
    rec.omr.studentMatch={exact:false,distance:null,studentId:null,run:typed,name:'RUN ingresado manualmente',manual:true};
    rec.omr.runIssues=[];
  }

  // Si la hoja sigue cargada en el lote, sincronizamos también su OMR.
  const page=(state.scanPages||[]).find(p=>p.label===rec.label);
  if(page?.omr){
    page.omr.run=rec.omr.run;
    page.omr.studentMatch=JSON.parse(JSON.stringify(rec.omr.studentMatch));
    page.omr.runIssues=[];
  }
  state.review=state.review.filter(r=>!(r.file===rec.label&&r.type==='Revisar RUN'));
  logActivity('identity_changed',`${rec.label} → ${rec.omr.studentMatch?.name||rec.omr.studentMatch?.run||'Sin identificar'}`,{evaluationId:rec.evaluationId,resultKey:rec.key,studentId:rec.omr.studentMatch?.studentId||null});
  persist();closeModal('resultIdentityModal');renderReview();renderScan();renderResults();renderStats();
}
async function deleteScannedResult(resultKey){
  const rec=resultRecordByKey(resultKey);if(!rec)return;
  const ev=state.evaluations.find(e=>e.id===rec.evaluationId);
  const who=rec.omr?.studentMatch?.name||rec.omr?.studentMatch?.run||'sin identificar';
  if(!confirm(`Eliminar este escaneo de “${ev?.name||'la evaluación'}” (${who})?\n\nSe eliminarán el resultado guardado, su evidencia corregida y las incidencias asociadas. Esta acción no se puede deshacer.`))return;
  await evidenceDelete(rec.evidenceKey||rec.key);
  logActivity('scan_deleted',`${rec.label} · ${who}`,{evaluationId:rec.evaluationId,resultKey:rec.key,studentId:rec.omr?.studentMatch?.studentId||null});
  state.results=state.results.filter(r=>r.key!==rec.key);
  state.review=state.review.filter(r=>r.file!==rec.label);
  const pi=(state.scanPages||[]).findIndex(p=>p.label===rec.label);
  if(pi>=0)state.scanPages.splice(pi,1);
  persist();renderReview();renderScan();renderResults();renderStats();renderDashboard();renderCourses();
}

function renderCourseSummary(ev,rows,body){
  const sorted=rows.slice().sort((a,b)=>b.percent-a.percent);
  body.innerHTML=`<div style="overflow:auto"><table class="result-table"><thead><tr>
    <th>Estudiante</th><th>Forma</th><th>Puntaje</th><th>Logro</th>${ev.type==='sumativa'?'<th>Nota</th>':''}<th>Estado</th><th>Acciones</th>
  </tr></thead><tbody>${sorted.map(r=>`<tr>
    <td><strong>${esc(resultStudentName(r))}</strong></td><td>${esc(r.form||'—')}</td>
    <td>${r.earned.toFixed(1)} / ${r.max.toFixed(1)}</td><td>${r.percent.toFixed(1)}%</td>
    ${ev.type==='sumativa'?`<td><strong>${r.grade?.toFixed(1)??'—'}</strong></td>`:''}
    <td>${r.student?'<span class="flag ok">Identificado</span>':'<span class="flag warn">Sin identificar</span>'}${r.page.duplicateOf?'<br><span class="flag warn">Posible duplicado</span>':''}</td>
    <td><div class="evidence-actions">
      <button class="secondary small" onclick="showCorrectionEvidence('${r.page.key}')">Ver hoja</button>
      <button class="secondary small" onclick="openResultIdentityReview('${r.page.key}')">${r.student?'Cambiar estudiante':'Revisar identificación'}</button>
      <button class="danger small" onclick="deleteScannedResult('${r.page.key}')">Eliminar escaneo</button>
    </div></td>
  </tr>`).join('')}</tbody></table></div>`;
}

function studentQuestionBreakdown(r){
  const items=r.cfg?.items||[];
  return items.map((q,i)=>{
    const a=r.omr.answers?.[i];
    const answer=(a?.answer||'').toUpperCase();
    const key=String(q.key||'').toUpperCase();
    const pts=Math.max(0,Number(q.points)||0);
    let status='blank',label='En blanco',earned=0;
    if(q.active===false){status='void';label='Anulada'}
    else if(!answer){status='blank';label='En blanco'}
    else if(answer===key){status='correct';label='Correcta';earned=pts}
    else{status='incorrect';label='Incorrecta'}
    return {n:i+1,q,a,answer,key,pts,earned,status,label};
  });
}
function studentQuestionCounts(r){
  const qs=studentQuestionBreakdown(r);
  const active=qs.filter(x=>x.status!=='void');
  return {
    total:qs.length,
    correct:active.filter(x=>x.status==='correct').length,
    incorrect:active.filter(x=>x.status==='incorrect').length,
    blank:active.filter(x=>x.status==='blank').length,
    voided:qs.filter(x=>x.status==='void').length,
    answered:active.filter(x=>x.status==='correct'||x.status==='incorrect').length
  };
}

async function showCorrectionEvidence(resultKey){
  const rec=state.results.find(x=>x.key===resultKey||x.id===resultKey);
  const box=$('#evidenceModalContent');if(!box)return;
  box.innerHTML='<div class="empty">Cargando hoja corregida…</div>';openModal('evidenceModal');
  const blob=await evidenceGet(rec?.evidenceKey||resultKey);
  if(!blob){
    box.innerHTML='<div class="empty">No hay una imagen de corrección guardada para este resultado. Las evidencias se generan a partir de los escaneos realizados desde la v0.24.</div>';
    return;
  }
  const url=URL.createObjectURL(blob);
  box.innerHTML=`<div class="evidence-wrap">
    <div class="evidence-legend"><span><i class="evidence-dot correct"></i>Respuesta correcta</span><span><i class="evidence-dot incorrect"></i>Respuesta incorrecta</span><span><i class="evidence-dot blank"></i>En blanco</span></div>
    <img src="${url}" alt="Hoja corregida">
    <div class="evidence-actions"><button class="secondary" onclick="downloadCorrectionEvidence('${rec?.key||resultKey}')">Descargar JPG</button></div>
    <div class="mini-note">Esta imagen conserva la lectura visual realizada por el algoritmo. Las marcas se dibujan después de la lectura y no intervienen en la decisión OMR. Si un estudiante cuestiona una corrección, puedes contrastarla con la hoja original y modificar la revisión si corresponde.</div>
  </div>`;
}
async function downloadCorrectionEvidence(resultKey){
  const rec=state.results.find(x=>x.key===resultKey||x.id===resultKey);
  const blob=await evidenceGet(rec?.evidenceKey||resultKey);
  if(!blob)return alert('No hay evidencia guardada para este resultado.');
  const url=URL.createObjectURL(blob),a=document.createElement('a');
  const ev=state.evaluations.find(e=>e.id===rec.evaluationId);
  a.href=url;a.download=`Correccion_${(ev?.name||'evaluacion').replace(/[^\w\-]+/g,'_')}_${(rec.omr?.studentMatch?.name||rec.label||'hoja').replace(/[^\w\-]+/g,'_')}.jpg`;
  a.click();setTimeout(()=>URL.revokeObjectURL(url),1200);
}

function renderStudentQuestionDetail(r,body){
  const qs=studentQuestionBreakdown(r),c=studentQuestionCounts(r);
  body.innerHTML=`<div class="student-question-summary">
    <div class="sq"><span>Respondidas</span><strong>${c.answered}</strong></div>
    <div class="sq"><span>Correctas</span><strong>${c.correct}</strong></div>
    <div class="sq"><span>Incorrectas</span><strong>${c.incorrect}</strong></div>
    <div class="sq"><span>En blanco</span><strong>${c.blank}</strong></div>
  </div>
  <div class="evidence-actions"><button class="secondary small" onclick="showCorrectionEvidence('${r.page.key}')">Ver hoja corregida</button></div>
  <div style="overflow:auto;margin-top:10px"><table class="result-table"><thead><tr>
    <th>Pregunta</th><th>Respuesta</th><th>Correcta</th><th>Estado</th><th>Puntaje</th><th>Habilidad</th><th>Contenido</th>
  </tr></thead><tbody>${qs.map(x=>`<tr>
    <td><strong>P${x.n}</strong></td>
    <td>${x.status==='void'?'—':esc(x.answer||'En blanco')}</td>
    <td>${x.status==='void'?'—':esc(x.key||'—')}</td>
    <td><span class="status-pill ${x.status}">${x.label}</span></td>
    <td>${x.status==='void'?'—':`${x.earned.toFixed(1)} / ${x.pts.toFixed(1)}`}</td>
    <td>${esc(x.q.skill||'—')}</td>
    <td>${esc(x.q.content||'—')}</td>
  </tr>`).join('')}</tbody></table></div>`;
}

function renderStudentSummary(ev,r,body){
  const qs=studentQuestionBreakdown(r),counts=studentQuestionCounts(r);
  const wrong=qs.filter(x=>x.status==='incorrect'||x.status==='blank');
  const skills=studentTagPerformance(r,'skill').sort((a,b)=>b.pct-a.pct);
  const contents=studentTagPerformance(r,'content').sort((a,b)=>b.pct-a.pct);
  body.innerHTML=`<div class="course-analysis">
    <div class="panel-lite"><h3>Desempeño general</h3>
      <div class="alert-list">
        <div class="alert-item"><span>RUN</span><strong>${esc(r.omr.studentMatch?.run||r.omr.run||'—')}</strong></div>
        <div class="alert-item"><span>Respondidas</span><strong>${counts.answered} / ${counts.total-counts.voided}</strong></div>
        <div class="alert-item"><span>Correctas</span><strong>${counts.correct}</strong></div>
        <div class="alert-item"><span>Incorrectas</span><strong>${counts.incorrect}</strong></div>
        <div class="alert-item"><span>En blanco</span><strong>${counts.blank}</strong></div>
        ${counts.voided?`<div class="alert-item"><span>Anuladas</span><strong>${counts.voided}</strong></div>`:''}
        <div class="alert-item"><span>Forma</span><strong>${esc(r.form||'—')}</strong></div>
      </div>
      <div class="evidence-actions"><button class="secondary small" onclick="showCorrectionEvidence('${r.page.key}')">Ver hoja corregida</button></div>
    </div>
    <div class="panel-lite"><h3>Habilidades</h3><div class="alert-list">${skills.length?skills.map(x=>`<div class="alert-item ${x.pct<60?'bad':x.pct>=80?'good':''}"><span>${esc(x.tag)}</span><strong>${x.pct.toFixed(1)}%</strong></div>`).join(''):'<div class="meta">Sin habilidades configuradas.</div>'}</div></div>
    <div class="panel-lite"><h3>Contenidos</h3><div class="alert-list">${contents.length?contents.map(x=>`<div class="alert-item ${x.pct<60?'bad':x.pct>=80?'good':''}"><span>${esc(x.tag)}</span><strong>${x.pct.toFixed(1)}%</strong></div>`).join(''):'<div class="meta">Sin contenidos configurados.</div>'}</div></div>
    <div class="panel-lite"><h3>Preguntas a reforzar</h3><div class="alert-list">${wrong.length?wrong.slice(0,12).map(x=>`<div class="alert-item bad"><span>P${x.n}${x.q.content?' · '+esc(x.q.content):''}</span><strong>${x.status==='blank'?'Blanco':esc(x.answer)} → ${esc(x.key||'')}</strong></div>`).join(''):'<div class="meta">Sin errores registrados.</div>'}</div></div>
  </div>`;
}
function renderStudentResults(ev,rows,body){
  const sorted=rows.slice().sort((a,b)=>resultStudentName(a).localeCompare(resultStudentName(b),'es'));
  body.innerHTML=`<div style="overflow:auto"><table class="result-table"><thead><tr>
    <th>Estudiante</th><th>RUN</th><th>Forma</th><th>Puntaje</th><th>Logro</th>${ev.type==='sumativa'?'<th>Nota</th>':''}<th>Estado</th><th>Acciones</th>
  </tr></thead><tbody>${sorted.map(r=>`<tr>
    <td><strong>${esc(resultStudentName(r))}</strong></td>
    <td>${esc(r.omr.studentMatch?.run||r.omr.run||'—')}</td>
    <td>${esc(r.form||'—')}</td>
    <td>${r.earned.toFixed(1)} / ${r.max.toFixed(1)}</td>
    <td>${r.percent.toFixed(1)}%</td>
    ${ev.type==='sumativa'?`<td><strong>${r.grade?.toFixed(1)??'—'}</strong></td>`:''}
    <td>${r.student?'<span class="flag ok">Identificado</span>':'<span class="flag warn">Sin identificar</span>'}</td>
    <td><div class="evidence-actions"><button class="secondary small" onclick="showCorrectionEvidence('${r.page.key}')">Ver hoja</button><button class="secondary small" onclick="openResultIdentityReview('${r.page.key}')">Revisar</button><button class="danger small" onclick="deleteScannedResult('${r.page.key}')">Eliminar</button></div></td>
  </tr>`).join('')}</tbody></table></div>`;
}
function questionAggregate(ev,rows){
  const count=Math.max(...rows.map(r=>r.cfg?.items?.length||r.omr.answers.length),0);
  const out=[];
  for(let i=0;i<count;i++){
    let valid=0,correct=0;
    const dist={A:0,B:0,C:0,D:0,E:0,blank:0};
    let labelSkill='',labelContent='';
    rows.forEach(r=>{
      const q=r.cfg?.items?.[i]; if(!q||q.active===false)return;
      const a=r.omr.answers?.[i]; if(!a)return;
      valid++;
      const ans=a.answer||'blank'; if(dist[ans]!==undefined)dist[ans]++;
      if(a.answer===String(q.key||'').toUpperCase())correct++;
      if(!labelSkill&&q.skill)labelSkill=q.skill;
      if(!labelContent&&q.content)labelContent=q.content;
    });
    if(valid)out.push({n:i+1,valid,correct,pct:correct/valid*100,dist,skill:labelSkill,content:labelContent});
  }
  return out;
}
function renderQuestionResults(ev,rows,body){
  if(resultsScope==='student' && rows.length===1){
    renderStudentQuestionDetail(rows[0],body);
    return;
  }
  const qs=questionAggregate(ev,rows);
  body.innerHTML=`<div class="question-grid">${qs.map(q=>{
    const cls=q.pct<50?'bad':q.pct>=80?'good':'';
    const dist=Object.entries(q.dist).filter(([k,v])=>v>0).map(([k,v])=>`${k==='blank'?'Blanco':k}: ${v}`).join(' · ');
    return `<div class="qmetric ${cls}"><div class="top"><strong>P${q.n}</strong><strong>${q.pct.toFixed(0)}%</strong></div>
      <div class="meta">${esc(q.skill||'Sin habilidad')}${q.content?' · '+esc(q.content):''}</div>
      <div class="dist">${dist}</div></div>`;
  }).join('')}</div>`;
}
function aggregateByTag(ev,rows,field){
  const map=new Map();
  rows.forEach(r=>{
    (r.cfg?.items||[]).forEach((q,i)=>{
      if(q.active===false)return;
      const tag=String(q[field]||'').trim()||`Sin ${field==='skill'?'habilidad':'contenido'}`;
      const a=r.omr.answers?.[i]; if(!a)return;
      if(!map.has(tag))map.set(tag,{tag,total:0,correct:0});
      const m=map.get(tag);m.total++;if(a.answer===String(q.key||'').toUpperCase())m.correct++;
    })
  });
  return [...map.values()].map(x=>({...x,pct:x.total?x.correct/x.total*100:0})).sort((a,b)=>b.pct-a.pct);
}
function renderTagResults(ev,rows,body,field,label){
  const data=aggregateByTag(ev,rows,field);
  body.innerHTML=data.length?`<div class="metric-bars">${data.map(x=>`<div class="metric-row">
    <strong>${esc(x.tag)}</strong><div class="metric-track"><div style="width:${Math.max(0,Math.min(100,x.pct))}%"></div></div><div class="pct">${x.pct.toFixed(1)}%</div>
  </div>`).join('')}</div>`:`<div class="empty">No hay ${label.toLowerCase()} configurado en las preguntas de esta evaluación.</div>`;
}

function courseInsights(ev,rows){
  const qs=questionAggregate(ev,rows);
  const skills=aggregateByTag(ev,rows,'skill').filter(x=>!x.tag.startsWith('Sin '));
  const contents=aggregateByTag(ev,rows,'content').filter(x=>!x.tag.startsWith('Sin '));
  const lowQuestions=qs.slice().sort((a,b)=>a.pct-b.pct).slice(0,5);
  const highQuestions=qs.slice().sort((a,b)=>b.pct-a.pct).slice(0,5);
  const lowSkills=skills.slice().sort((a,b)=>a.pct-b.pct).slice(0,4);
  const lowContents=contents.slice().sort((a,b)=>a.pct-b.pct).slice(0,4);
  const threshold=60;
  const atRisk=rows.filter(r=>r.percent<threshold).sort((a,b)=>a.percent-b.percent);
  return {qs,skills,contents,lowQuestions,highQuestions,lowSkills,lowContents,atRisk,threshold};
}
function renderCourseAnalysisPreview(ev,rows){
  const box=$('#courseAnalysisPreview'); if(!box)return;
  const x=courseInsights(ev,rows);
  const weakest=[
    ...x.lowSkills.map(v=>({label:`Habilidad: ${v.tag}`,pct:v.pct})),
    ...x.lowContents.map(v=>({label:`Contenido: ${v.tag}`,pct:v.pct}))
  ].sort((a,b)=>a.pct-b.pct).slice(0,5);
  box.innerHTML=`<div class="course-analysis">
    <div class="panel-lite">
      <h3>Aspectos a reforzar</h3>
      <div class="alert-list">${weakest.length?weakest.map(v=>`<div class="alert-item bad"><span>${esc(v.label)}</span><strong>${v.pct.toFixed(1)}%</strong></div>`).join(''):'<div class="meta">No hay habilidades o contenidos etiquetados.</div>'}</div>
    </div>
    <div class="panel-lite">
      <h3>Preguntas con mayor dificultad</h3>
      <div class="alert-list">${x.lowQuestions.length?x.lowQuestions.map(v=>`<div class="alert-item bad"><span>P${v.n}${v.skill?' · '+esc(v.skill):''}</span><strong>${v.pct.toFixed(1)}%</strong></div>`).join(''):'<div class="meta">Sin datos.</div>'}</div>
    </div>
    <div class="panel-lite">
      <h3>Fortalezas</h3>
      <div class="alert-list">${x.highQuestions.length?x.highQuestions.map(v=>`<div class="alert-item good"><span>P${v.n}${v.content?' · '+esc(v.content):''}</span><strong>${v.pct.toFixed(1)}%</strong></div>`).join(''):'<div class="meta">Sin datos.</div>'}</div>
    </div>
    <div class="panel-lite">
      <h3>Estudiantes bajo ${x.threshold}% de logro</h3>
      <div class="alert-list">${x.atRisk.length?x.atRisk.slice(0,8).map(r=>`<div class="alert-item"><span>${esc(resultStudentName(r))}</span><strong>${r.percent.toFixed(1)}%</strong></div>`).join(''):'<div class="meta">No hay estudiantes bajo el umbral.</div>'}</div>
    </div>
  </div>`;
}
function printCourseReport(){
  const eid=$('#resultsEvaluation')?.value||'';
  const ev=state.evaluations.find(e=>e.id===eid);
  let rows=resultRowsForEvaluation(eid);const form=$('#resultsForm')?.value||'';if(form)rows=rows.filter(r=>r.form===form);
  if(!ev||!rows.length)return alert('No hay resultados para generar el informe de curso.');

  const x=courseInsights(ev,rows);
  const avgPct=rows.reduce((s,r)=>s+r.percent,0)/rows.length;
  const graded=rows.filter(r=>r.grade!==null);
  const avgGrade=graded.length?graded.reduce((s,r)=>s+r.grade,0)/graded.length:null;
  const passGrade=Number(ev.grading?.passGrade||4);
  const passed=graded.filter(r=>r.grade>=passGrade).length;
  const course=courseById(ev.courseId);
  const skills=x.skills.slice().sort((a,b)=>b.pct-a.pct);
  const contents=x.contents.slice().sort((a,b)=>b.pct-a.pct);

  const qRows=x.qs.slice().sort((a,b)=>a.pct-b.pct).map(q=>{
    const dist=Object.entries(q.dist).filter(([k,v])=>v>0).map(([k,v])=>`${k==='blank'?'Blanco':k}: ${v}`).join(' · ');
    return `<tr><td>P${q.n}</td><td>${q.pct.toFixed(1)}%</td><td>${esc(q.skill||'—')}</td><td>${esc(q.content||'—')}</td><td>${esc(dist||'—')}</td></tr>`;
  }).join('');

  const w=window.open('','_blank');
  if(!w)return alert('El navegador bloqueó la ventana del informe.');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Informe de curso</title>
  <style>
    body{font-family:Arial,sans-serif;color:#1e2935;margin:0;background:#fff}
    .report{padding:30px;max-width:980px;margin:auto}
    h1{font-size:22px;margin:0}h2{font-size:15px;margin-top:24px;border-bottom:1px solid #dfe5eb;padding-bottom:6px}
    .sub{color:#657282;margin:6px 0 18px}.boxes{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}
    .box{border:1px solid #dbe3ea;border-radius:9px;padding:11px}.box span{display:block;font-size:10px;color:#6a7682}.box b{font-size:19px}
    .cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}.metric{display:flex;justify-content:space-between;border-bottom:1px solid #eef1f4;padding:6px 0;font-size:11px}
    table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border-bottom:1px solid #e1e5e9;padding:6px;text-align:left}th{background:#f7f9fb}
    .note{font-size:10px;color:#687481;margin-top:16px}.bad{color:#9b2c2c}.good{color:#276749}
    @media print{.report{padding:12mm}.pagebreak{page-break-before:always}}
  
.choice-buttons button.pending{outline:2px solid #2458c6;outline-offset:2px}
.review-savebar{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
.review-savebar .status{margin-right:auto;font-size:11px;color:var(--muted)}


.history-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.history-stat{border:1px solid var(--line);border-radius:10px;padding:10px;background:#fff}
.history-stat span{display:block;font-size:10px;color:var(--muted)}
.history-stat strong{display:block;font-size:18px;margin-top:4px}
.progress-line{display:flex;align-items:center;gap:8px}
.progress-line .bar{height:8px;flex:1;background:#e8edf2;border-radius:999px;overflow:hidden}
.progress-line .bar>div{height:100%;background:#607d9b}
.student-link{border:0;background:transparent;color:#2458c6;padding:0;cursor:pointer;font-weight:700;text-align:left}
.history-table{width:100%;border-collapse:collapse;font-size:11px}
.history-table th,.history-table td{padding:7px;border-bottom:1px solid var(--line);text-align:left}
.history-table th{color:var(--muted);background:#f8fafc}


.student-question-summary{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin-bottom:12px}
.student-question-summary .sq{border:1px solid var(--line);border-radius:10px;padding:9px;background:#fff}
.student-question-summary .sq span{display:block;font-size:10px;color:var(--muted)}
.student-question-summary .sq strong{display:block;font-size:17px;margin-top:3px}
.status-pill{display:inline-flex;align-items:center;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:700}
.status-pill.correct{background:#eefaf3;color:#26734d}
.status-pill.incorrect{background:#fff1ef;color:#9b3428}
.status-pill.blank{background:#f2f5f8;color:#5c6977}
.status-pill.void{background:#f4f1fb;color:#6f55a0}
@media(max-width:700px){.student-question-summary{grid-template-columns:1fr 1fr}}


.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.compare-card{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff}
.compare-card h3{font-size:13px;margin:0 0 10px}
.trend-list{display:grid;gap:8px}
.trend-row{display:grid;grid-template-columns:minmax(130px,1fr) 2fr 64px;gap:9px;align-items:center}
.trend-row .bar{height:9px;background:#e8edf2;border-radius:999px;overflow:hidden}
.trend-row .bar>div{height:100%;background:#607d9b}
.trend-row .val{text-align:right;font-variant-numeric:tabular-nums}
.delta.up{color:#26734d}.delta.down{color:#9b3428}.delta.flat{color:#657282}
.spark{display:flex;align-items:end;gap:4px;height:70px;padding-top:8px}
.spark span{flex:1;min-width:8px;background:#607d9b;border-radius:3px 3px 0 0;position:relative}
.spark span em{position:absolute;bottom:-17px;left:50%;transform:translateX(-50%);font-size:8px;color:var(--muted);font-style:normal;white-space:nowrap}
@media(max-width:850px){.compare-grid{grid-template-columns:1fr}.trend-row{grid-template-columns:1fr}}


.data-warning{border:1px solid #f1c36d;background:#fff8e8;border-radius:12px;padding:11px 12px;margin:10px 0;display:flex;gap:12px;align-items:center;justify-content:space-between}
.data-warning strong{display:block;font-size:12px}.data-warning .meta{margin-top:2px}
.archived-item{opacity:.72;background:#fafbfc}
.archive-badge{background:#eef1f4;color:#586472}
.danger-zone{border-top:1px solid var(--line);margin-top:12px;padding-top:12px}
.backup-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
.backup-summary div{border:1px solid var(--line);border-radius:9px;padding:8px;background:#f8fafc}
.backup-summary span{display:block;font-size:9px;color:var(--muted)}.backup-summary strong{font-size:15px}
@media(max-width:750px){.data-warning{align-items:flex-start;flex-direction:column}.backup-summary{grid-template-columns:1fr 1fr}}


.option-wrap{display:inline-flex;align-items:center;position:relative;margin:2px 5px 2px 0}
.opt-btn.correct{box-shadow:inset 0 0 0 3px #2458c6;background:#e7efff;color:#2458c6}
.opt-btn.inactive{background:#f3f5f7;color:#8a96a3;border-style:dashed}
.opt-remove{position:absolute;right:-5px;top:-7px;width:17px;height:17px;min-width:17px;padding:0;border-radius:50%;border:1px solid #d7dee6;background:#fff;color:#7c8793;font-size:11px;line-height:15px}
.opt-remove:hover{background:#fff0ee;color:#a2392d}


.integrity-grid{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin:10px 0}
.integrity-grid>div{border:1px solid var(--line);border-radius:10px;padding:9px;background:#f8fafc}
.integrity-grid span{display:block;font-size:9px;color:var(--muted)}
.integrity-grid strong{display:block;font-size:16px;margin-top:3px}
.integrity-list{display:grid;gap:6px;margin-top:10px}
.integrity-item{display:flex;justify-content:space-between;gap:10px;padding:7px 9px;border-radius:8px;background:#f8fafc;font-size:11px}
.integrity-item.warn{background:#fff7e8;color:#8a5b00}
.integrity-item.ok{background:#eefaf3;color:#26734d}
.schema-pill{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;background:#e8f0ff;color:#2458c6;font-size:10px;font-weight:700}
@media(max-width:750px){.integrity-grid{grid-template-columns:1fr 1fr}}


.evidence-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.evidence-wrap{display:grid;gap:10px}
.evidence-wrap img{width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:#fff}
.evidence-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--muted)}
.evidence-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.evidence-dot.correct{background:#2d8a5d}.evidence-dot.incorrect{background:#c84d3f}.evidence-dot.blank{background:#d69a23}


.backup-progress{margin-top:10px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:#f8fafc;font-size:11px;color:var(--muted)}
.backup-progress strong{color:var(--text)}


.audit-list{display:grid;gap:7px}
.audit-item{border:1px solid var(--line);border-radius:10px;padding:9px 10px;background:#fff}
.audit-item .top{display:flex;justify-content:space-between;gap:10px;align-items:center}
.audit-item .time{font-size:9px;color:var(--muted);white-space:nowrap}
.audit-item .detail{font-size:11px;color:var(--muted);margin-top:4px}
.duplicate-warning{border:1px solid #efc36d;background:#fff8e7;border-radius:10px;padding:9px 10px;margin-top:8px}


.module-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px}
.module-card{border:1px solid var(--line);border-radius:11px;padding:10px;background:#fff}
.module-card .head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.module-card strong{font-size:12px}
.module-card p{font-size:10px;color:var(--muted);margin:5px 0 0}
.module-status{font-size:9px;font-weight:800;border-radius:999px;padding:3px 7px;background:#e9f7ef;color:#24724e}
.module-status.warn{background:#fff3d9;color:#946518}
.tech-check{margin-top:10px;border:1px solid var(--line);border-radius:10px;padding:10px;background:#f8fafc}
.tech-check .ok{color:#24724e}.tech-check .warn{color:#946518}

</style></head><body><div class="report">
    <h1>Informe de curso</h1>
    <div class="sub"><strong>${esc(ev.name)}</strong> · ${esc(courseName(course))}${ev.date?' · '+esc(ev.date):''} · ${ev.type==='sumativa'?'Sumativa':'Formativa'}</div>
    <div class="boxes">
      <div class="box"><span>Estudiantes evaluados</span><b>${rows.length}</b></div>
      <div class="box"><span>Logro promedio</span><b>${avgPct.toFixed(1)}%</b></div>
      ${ev.type==='sumativa'?`<div class="box"><span>Nota promedio</span><b>${avgGrade===null?'—':avgGrade.toFixed(1)}</b></div>
      <div class="box"><span>Aprobación</span><b>${graded.length?Math.round(passed/graded.length*100)+'%':'—'}</b></div>`:
      `<div class="box"><span>Identificados</span><b>${rows.filter(r=>r.student).length}/${rows.length}</b></div>
       <div class="box"><span>Bajo 60%</span><b>${x.atRisk.length}</b></div>`}
    </div>

    <div class="cols">
      <div><h2>Habilidades</h2>${skills.length?skills.map(v=>`<div class="metric"><span>${esc(v.tag)}</span><b class="${v.pct<60?'bad':v.pct>=80?'good':''}">${v.pct.toFixed(1)}%</b></div>`).join(''):'<div class="note">Sin habilidades etiquetadas.</div>'}</div>
      <div><h2>Contenidos</h2>${contents.length?contents.map(v=>`<div class="metric"><span>${esc(v.tag)}</span><b class="${v.pct<60?'bad':v.pct>=80?'good':''}">${v.pct.toFixed(1)}%</b></div>`).join(''):'<div class="note">Sin contenidos etiquetados.</div>'}</div>
    </div>

    <div class="cols">
      <div><h2>Preguntas con mayor dificultad</h2>${x.lowQuestions.map(v=>`<div class="metric"><span>P${v.n}${v.content?' · '+esc(v.content):''}</span><b class="bad">${v.pct.toFixed(1)}%</b></div>`).join('')}</div>
      <div><h2>Estudiantes bajo ${x.threshold}%</h2>${x.atRisk.length?x.atRisk.map(r=>`<div class="metric"><span>${esc(resultStudentName(r))}</span><b>${r.percent.toFixed(1)}%</b></div>`).join(''):'<div class="note">Sin estudiantes bajo el umbral.</div>'}</div>
    </div>

    <div class="pagebreak"></div>
    <h2>Detalle por pregunta</h2>
    <table><thead><tr><th>Pregunta</th><th>Logro</th><th>Habilidad</th><th>Contenido</th><th>Distribución de respuestas</th></tr></thead>
      <tbody>${qRows}</tbody></table>

    <div class="note">Los apartados de fortalezas y aspectos a reforzar se basan en porcentajes de logro de esta evaluación. La interpretación pedagógica final corresponde al docente.</div>
  </div></body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),300);
}

function exportResultsCsv(){
  const eid=$('#resultsEvaluation')?.value||'',ev=state.evaluations.find(e=>e.id===eid);let rows=resultRowsForEvaluation(eid);
  const form=$('#resultsForm')?.value||'';if(form)rows=rows.filter(r=>r.form===form);
  if(resultsScope==='student'){const sid=$('#resultsStudent')?.value||'';rows=rows.filter(r=>r.student?.id===sid)};
  if(!ev||!rows.length)return alert('No hay resultados para exportar.');
  const headers=['Estudiante','RUN','Forma','Puntaje','PuntajeMaximo','Porcentaje'];
  if(ev.type==='sumativa')headers.push('Nota');
  const lines=[headers.join(';')];
  rows.forEach(r=>{
    const vals=[resultStudentName(r),r.omr.studentMatch?.run||r.omr.run||'',r.form,r.earned.toFixed(2),r.max.toFixed(2),r.percent.toFixed(2)];
    if(ev.type==='sumativa')vals.push(r.grade?.toFixed(1)??'');
    lines.push(vals.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(';'));
  });
  const blob=new Blob(['\ufeff'+lines.join('\n')],{type:'text/csv;charset=utf-8'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`Resultados_${ev.name.replace(/[^\w\-]+/g,'_')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
function printStudentReports(){
  const eid=$('#resultsEvaluation')?.value||'',ev=state.evaluations.find(e=>e.id===eid);
  let rows=resultRowsForEvaluation(eid);
  const form=$('#resultsForm')?.value||'';if(form)rows=rows.filter(r=>r.form===form);
  if(resultsScope==='student'){
    const sid=$('#resultsStudent')?.value||'';
    rows=rows.filter(r=>r.student?.id===sid);
  }
  if(!ev||!rows.length)return alert('No hay resultados para imprimir.');
  const w=window.open('','_blank');
  if(!w)return alert('El navegador bloqueó la ventana de impresión.');
  const reports=rows.map(r=>{
    const skills=studentTagPerformance(r,'skill'),contents=studentTagPerformance(r,'content');
    const qs=studentQuestionBreakdown(r),counts=studentQuestionCounts(r);
    return `<section class="report">
      <h1>${esc(ev.name)}</h1>
      <div class="sub">${esc(courseName(courseById(ev.courseId)))} · ${esc(resultStudentName(r))} · Forma ${esc(r.form||'—')}</div>
      <div class="boxes">
        <div><span>Puntaje</span><b>${r.earned.toFixed(1)} / ${r.max.toFixed(1)}</b></div>
        <div><span>Logro</span><b>${r.percent.toFixed(1)}%</b></div>
        ${ev.type==='sumativa'?`<div><span>Nota</span><b>${r.grade?.toFixed(1)??'—'}</b></div>`:''}
        <div><span>Respondidas</span><b>${counts.answered}/${counts.total-counts.voided}</b></div>
        <div><span>Correctas</span><b>${counts.correct}</b></div>
        <div><span>Incorrectas</span><b>${counts.incorrect}</b></div>
        <div><span>En blanco</span><b>${counts.blank}</b></div>
      </div>

      <h2>Detalle por pregunta</h2>
      <table><thead><tr><th>Pregunta</th><th>Respuesta</th><th>Correcta</th><th>Estado</th><th>Puntaje</th></tr></thead><tbody>
        ${qs.map(x=>`<tr>
          <td>${x.n}</td>
          <td>${x.status==='void'?'—':esc(x.answer||'En blanco')}</td>
          <td>${x.status==='void'?'—':esc(x.key||'—')}</td>
          <td><span class="st ${x.status}">${x.label}</span></td>
          <td>${x.status==='void'?'—':`${x.earned.toFixed(1)} / ${x.pts.toFixed(1)}`}</td>
        </tr>`).join('')}
      </tbody></table>

      ${renderPrintTagBlock('Habilidades',skills)}
      ${renderPrintTagBlock('Contenidos',contents)}
    </section>`;
  }).join('');

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Informes individuales</title><style>
    body{font-family:Arial,sans-serif;color:#1e2935;margin:0}.report{padding:28px;page-break-after:always}.report:last-child{page-break-after:auto}
    h1{font-size:20px;margin:0}.sub{margin:5px 0 18px;color:#637083}.boxes{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px}.boxes div{border:1px solid #d8e0e8;padding:9px 13px;border-radius:8px}.boxes span{display:block;font-size:9px;color:#657282}.boxes b{font-size:16px}
    h2{font-size:14px;margin-top:20px}table{width:100%;border-collapse:collapse;font-size:10.5px}th,td{border-bottom:1px solid #ddd;padding:5px;text-align:left}.bars{font-size:11px;line-height:1.8}
    .st{display:inline-block;border-radius:999px;padding:2px 6px;font-size:9px;font-weight:bold}.st.correct{background:#eefaf3;color:#26734d}.st.incorrect{background:#fff1ef;color:#9b3428}.st.blank{background:#f2f5f8;color:#5c6977}.st.void{background:#f4f1fb;color:#6f55a0}
    @media print{button{display:none}}
  
.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px}
.compare-card{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff}
.compare-card h3{font-size:13px;margin:0 0 10px}
.trend-list{display:grid;gap:8px}
.trend-row{display:grid;grid-template-columns:minmax(130px,1fr) 2fr 64px;gap:9px;align-items:center}
.trend-row .bar{height:9px;background:#e8edf2;border-radius:999px;overflow:hidden}
.trend-row .bar>div{height:100%;background:#607d9b}
.trend-row .val{text-align:right;font-variant-numeric:tabular-nums}
.delta.up{color:#26734d}.delta.down{color:#9b3428}.delta.flat{color:#657282}
.spark{display:flex;align-items:end;gap:4px;height:70px;padding-top:8px}
.spark span{flex:1;min-width:8px;background:#607d9b;border-radius:3px 3px 0 0;position:relative}
.spark span em{position:absolute;bottom:-17px;left:50%;transform:translateX(-50%);font-size:8px;color:var(--muted);font-style:normal;white-space:nowrap}
@media(max-width:850px){.compare-grid{grid-template-columns:1fr}.trend-row{grid-template-columns:1fr}}


.data-warning{border:1px solid #f1c36d;background:#fff8e8;border-radius:12px;padding:11px 12px;margin:10px 0;display:flex;gap:12px;align-items:center;justify-content:space-between}
.data-warning strong{display:block;font-size:12px}.data-warning .meta{margin-top:2px}
.archived-item{opacity:.72;background:#fafbfc}
.archive-badge{background:#eef1f4;color:#586472}
.danger-zone{border-top:1px solid var(--line);margin-top:12px;padding-top:12px}
.backup-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0}
.backup-summary div{border:1px solid var(--line);border-radius:9px;padding:8px;background:#f8fafc}
.backup-summary span{display:block;font-size:9px;color:var(--muted)}.backup-summary strong{font-size:15px}
@media(max-width:750px){.data-warning{align-items:flex-start;flex-direction:column}.backup-summary{grid-template-columns:1fr 1fr}}


.option-wrap{display:inline-flex;align-items:center;position:relative;margin:2px 5px 2px 0}
.opt-btn.correct{box-shadow:inset 0 0 0 3px #2458c6;background:#e7efff;color:#2458c6}
.opt-btn.inactive{background:#f3f5f7;color:#8a96a3;border-style:dashed}
.opt-remove{position:absolute;right:-5px;top:-7px;width:17px;height:17px;min-width:17px;padding:0;border-radius:50%;border:1px solid #d7dee6;background:#fff;color:#7c8793;font-size:11px;line-height:15px}
.opt-remove:hover{background:#fff0ee;color:#a2392d}


.integrity-grid{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:8px;margin:10px 0}
.integrity-grid>div{border:1px solid var(--line);border-radius:10px;padding:9px;background:#f8fafc}
.integrity-grid span{display:block;font-size:9px;color:var(--muted)}
.integrity-grid strong{display:block;font-size:16px;margin-top:3px}
.integrity-list{display:grid;gap:6px;margin-top:10px}
.integrity-item{display:flex;justify-content:space-between;gap:10px;padding:7px 9px;border-radius:8px;background:#f8fafc;font-size:11px}
.integrity-item.warn{background:#fff7e8;color:#8a5b00}
.integrity-item.ok{background:#eefaf3;color:#26734d}
.schema-pill{display:inline-flex;align-items:center;padding:3px 7px;border-radius:999px;background:#e8f0ff;color:#2458c6;font-size:10px;font-weight:700}
@media(max-width:750px){.integrity-grid{grid-template-columns:1fr 1fr}}


.evidence-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.evidence-wrap{display:grid;gap:10px}
.evidence-wrap img{width:100%;height:auto;border:1px solid var(--line);border-radius:10px;background:#fff}
.evidence-legend{display:flex;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--muted)}
.evidence-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:-1px}
.evidence-dot.correct{background:#2d8a5d}.evidence-dot.incorrect{background:#c84d3f}.evidence-dot.blank{background:#d69a23}


.backup-progress{margin-top:10px;padding:9px 10px;border:1px solid var(--line);border-radius:9px;background:#f8fafc;font-size:11px;color:var(--muted)}
.backup-progress strong{color:var(--text)}


.audit-list{display:grid;gap:7px}
.audit-item{border:1px solid var(--line);border-radius:10px;padding:9px 10px;background:#fff}
.audit-item .top{display:flex;justify-content:space-between;gap:10px;align-items:center}
.audit-item .time{font-size:9px;color:var(--muted);white-space:nowrap}
.audit-item .detail{font-size:11px;color:var(--muted);margin-top:4px}
.duplicate-warning{border:1px solid #efc36d;background:#fff8e7;border-radius:10px;padding:9px 10px;margin-top:8px}


.module-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:9px}
.module-card{border:1px solid var(--line);border-radius:11px;padding:10px;background:#fff}
.module-card .head{display:flex;justify-content:space-between;align-items:center;gap:8px}
.module-card strong{font-size:12px}
.module-card p{font-size:10px;color:var(--muted);margin:5px 0 0}
.module-status{font-size:9px;font-weight:800;border-radius:999px;padding:3px 7px;background:#e9f7ef;color:#24724e}
.module-status.warn{background:#fff3d9;color:#946518}
.tech-check{margin-top:10px;border:1px solid var(--line);border-radius:10px;padding:10px;background:#f8fafc}
.tech-check .ok{color:#24724e}.tech-check .warn{color:#946518}

</style></head><body>${reports}</body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),300);
}
function studentTagPerformance(r,field){
  const map=new Map();
  (r.cfg?.items||[]).forEach((q,i)=>{
    if(q.active===false)return;
    const tag=String(q[field]||'').trim();if(!tag)return;
    const a=r.omr.answers?.[i];if(!a)return;
    if(!map.has(tag))map.set(tag,{tag,total:0,correct:0});
    const x=map.get(tag);x.total++;if(a.answer===String(q.key||'').toUpperCase())x.correct++;
  });
  return [...map.values()].map(x=>({...x,pct:x.total?x.correct/x.total*100:0}));
}
function renderPrintTagBlock(title,data){
  if(!data.length)return '';
  return `<h2>${title}</h2><div class="bars">${data.map(x=>`${esc(x.tag)}: <b>${x.pct.toFixed(0)}%</b> (${x.correct}/${x.total})`).join('<br>')}</div>`;
}

function renderStats(){$('#statCourses').textContent=state.courses.length;$('#statStudents').textContent=state.students.length;$('#statEvaluations').textContent=state.evaluations.length;$('#statReview').textContent=state.review.length}
function allKnownYears(){return [...new Set([...state.years.map(y=>Number(y.year)),...state.courses.map(c=>Number(c.year)),currentYear].filter(Number.isFinite))].sort((a,b)=>b-a)}
function fillYearSelect(sel,value){if(!sel)return;const years=allKnownYears();sel.innerHTML=years.map(y=>`<option value="${y}">${y}</option>`).join('');if(value&&years.includes(Number(value)))sel.value=String(value)}
function defaultSchoolYear(year){
  const source=state.years.slice().sort((a,b)=>Math.abs(a.year-year)-Math.abs(b.year-year))[0];
  const shift=v=>v?`${year}${v.slice(4)}`:'';
  return {year,start:source?shift(source.start):`${year}-03-01`,vacStart:source?shift(source.vacStart):`${year}-07-01`,vacEnd:source?shift(source.vacEnd):`${year}-07-31`,end:source?shift(source.end):`${year}-12-01`};
}
function addSchoolYear(){
  const raw=prompt('¿Qué año escolar quieres agregar?\nEjemplo: 2027');if(raw===null)return;
  const year=Number(String(raw).trim());
  if(!Number.isInteger(year)||year<1900||year>2200)return alert('Ingresa un año válido entre 1900 y 2200.');
  if(state.years.some(y=>Number(y.year)===year)){selectSchoolYear(year);return alert(`El calendario ${year} ya existe.`)}
  state.years.push(defaultSchoolYear(year));state.years.sort((a,b)=>b.year-a.year);
  logActivity('school_year_added',`Calendario ${year}`,{year});persist();renderSettings();selectSchoolYear(year);
}
function loadSelectedSchoolYear(){
  const year=Number($('#settingsYear')?.value)||currentYear,y=state.years.find(x=>Number(x.year)===year);
  $('#schoolStart').value=y?.start||'';$('#vacStart').value=y?.vacStart||'';$('#vacEnd').value=y?.vacEnd||'';$('#schoolEnd').value=y?.end||'';renderSchoolYearList();
}
function renderSchoolYearList(){
  const box=$('#schoolYearList');if(!box)return;
  const selected=Number($('#settingsYear')?.value)||currentYear,rows=state.years.slice().sort((a,b)=>b.year-a.year);
  box.innerHTML=rows.length?rows.map(y=>{const cc=state.courses.filter(c=>Number(c.year)===Number(y.year)).length;return `<div class="year-row ${Number(y.year)===selected?'active':''}"><div><strong>${y.year}</strong><div class="dates">${dateCL(y.start)} · vacaciones ${dateCL(y.vacStart)}–${dateCL(y.vacEnd)} · término ${dateCL(y.end)}</div></div><div class="chips"><span class="chip">${cc} curso(s)</span><button class="secondary small" onclick="selectSchoolYear(${y.year})">Abrir</button></div></div>`}).join(''):'<div class="empty">No hay calendarios configurados.</div>';
}
function selectSchoolYear(year){fillYearSelect($('#settingsYear'),year);$('#settingsYear').value=String(year);loadSelectedSchoolYear()}
function deleteSchoolYear(){
  const year=Number($('#settingsYear')?.value),y=state.years.find(x=>Number(x.year)===year);
  if(!y)return alert('Este año todavía no tiene un calendario guardado.');
  const linked=state.courses.filter(c=>Number(c.year)===year);
  if(linked.length)return alert(`No se puede eliminar el calendario ${year} porque tiene ${linked.length} curso(s) asociado(s). Elimina primero esos cursos desde Cursos.`);
  if(state.years.length<=1)return alert('Debe existir al menos un calendario escolar.');
  if(!confirm(`¿Eliminar el calendario escolar ${year}?\n\nNo se eliminarán datos de otros años.`))return;
  state.years=state.years.filter(x=>Number(x.year)!==year);logActivity('school_year_deleted',`Calendario ${year}`,{year});persist();renderSettings();renderCourses();renderCalendar();renderDashboard();
}
function fillCourseSelect(sel,includeAll=false,value=''){const rows=state.courses.slice().sort((a,b)=>b.year-a.year||courseName(a).localeCompare(courseName(b)));sel.innerHTML=(includeAll?'<option value="">Todos los cursos</option>':'<option value="">Selecciona un curso</option>')+rows.map(c=>`<option value="${c.id}">${esc(courseName(c))} (${c.year})</option>`).join('');if(value)sel.value=value}
function renderDashboard(){const upcoming=state.evaluations.filter(e=>e.date&&e.date>=new Date().toISOString().slice(0,10)).sort((a,b)=>a.date.localeCompare(b.date)).slice(0,5);$('#dashboardUpcoming').innerHTML=upcoming.length?upcoming.map(e=>`<div class="list-item"><div><h4>${esc(e.name)}</h4><div class="meta">${dateCL(e.date)} · ${esc(courseName(courseById(e.courseId)))}</div><div class="chips"><span class="chip ${e.type==='formativa'?'formative':'summative'}">${e.type}</span><span class="status ${e.status}">${e.status}</span></div></div><button class="secondary small" onclick="openEditor('${e.id}')">Abrir</button></div>`).join(''):'<div class="empty">No hay evaluaciones próximas.</div>';const y=state.years.slice().sort((a,b)=>b.year-a.year)[0];$('#dashboardSchoolYear').innerHTML=y?`<div class="list"><div><strong>${y.year}</strong><div class="meta">Inicio: ${dateCL(y.start)}</div></div><div><strong>Vacaciones</strong><div class="meta">${dateCL(y.vacStart)} – ${dateCL(y.vacEnd)}</div></div><div><strong>Término</strong><div class="meta">${dateCL(y.end)}</div></div></div>`:'<div class="empty">Configura el año escolar.</div>'}
function openModal(id){$('#'+id).classList.remove('hidden')}function closeModal(id){$('#'+id).classList.add('hidden')}
function renderCourses(){
  updateEvaluationCreateButtons(false);
  fillYearSelect($('#courseYearFilter'),$('#courseYearFilter').value||currentYear);
  const year=Number($('#courseYearFilter').value)||currentYear,q=($('#courseSearch').value||'').toLowerCase();
  const rows=state.courses.filter(c=>c.year===year&&courseName(c).toLowerCase().includes(q));
  $('#courseList').innerHTML=rows.length?rows.map(c=>{
    const students=state.students.filter(s=>s.courseId===c.id).length;
    const evals=state.evaluations.filter(e=>e.courseId===c.id).length;
    return `<article class="panel course-card" onclick="openCourse('${c.id}')">
      <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
        <div><div class="big">${esc(c.level)} ${esc(c.letter)}</div><div class="meta">${esc(c.subject)} · ${c.year}</div></div>
        <button class="danger small" onclick="event.stopPropagation();deleteCourse('${c.id}')">Eliminar</button>
      </div>
      <div class="chips"><span class="chip">${students} estudiantes</span><span class="chip">${evals} evaluaciones</span></div>
    </article>`;
  }).join(''):'<div class="empty wide">No hay cursos para este año.</div>';
  $('#courseBrowser').classList.remove('hidden');$('#courseDetail').classList.add('hidden')
}
function goToEvaluationResults(eid){
  showView('results');
  setTimeout(()=>{fillResultsEvaluation();$('#resultsEvaluation').value=eid;resultsScope='course';renderResults()},0);
}
function studentAllResultRows(student){
  if(!student)return [];
  const person=student.personId?personById(student.personId):null;
  const targetRun=normalizeRunText(person?.run||student.run);
  const studentIds=new Set(
    person ? state.students.filter(s=>s.personId===person.id).map(s=>s.id)
           : state.students.filter(s=>targetRun&&normalizeRunText(s.run)===targetRun).map(s=>s.id)
  );
  const out=[];
  state.evaluations.forEach(ev=>{
    resultRowsForEvaluation(ev.id).forEach(r=>{
      const rr=normalizeRunText(r.omr?.studentMatch?.run||r.omr?.run||'');
      const linkedByStudent=r.student&&studentIds.has(r.student.id);
      const legacyRunFallback=!person && targetRun && rr===targetRun;
      if(linkedByStudent||legacyRunFallback)out.push({...r,ev});
    })
  });
  return out.sort((a,b)=>(b.ev.date||'').localeCompare(a.ev.date||''));
}

function studentTagTrend(rows,field){
  const chronological=rows.slice().sort((a,b)=>(a.ev.date||'').localeCompare(b.ev.date||''));
  const map=new Map();
  chronological.forEach(r=>{
    studentTagPerformance(r,field).forEach(x=>{
      if(!x.tag)return;
      if(!map.has(x.tag))map.set(x.tag,[]);
      map.get(x.tag).push({date:r.ev.date||'',name:r.ev.name,pct:x.pct});
    })
  });
  return [...map.entries()].map(([tag,vals])=>({tag,vals,latest:vals.at(-1)?.pct??0,delta:trendDelta(vals.map(v=>v.pct))}))
    .filter(x=>x.vals.length>=2).sort((a,b)=>a.latest-b.latest);
}
function renderStudentComparativeHTML(rows){
  const chronological=rows.slice().sort((a,b)=>(a.ev.date||'').localeCompare(b.ev.date||''));
  const values=chronological.map(r=>r.percent);
  const delta=trendDelta(values);
  const skills=studentTagTrend(rows,'skill').slice(0,5);
  const contents=studentTagTrend(rows,'content').slice(0,5);
  return `<div class="compare-grid">
    <div class="compare-card"><h3>Evolución del logro</h3>${renderSpark(chronological.map(r=>({pct:r.percent})))}
      <div class="meta">${chronological[0].ev.name}: ${values[0].toFixed(1)}% → ${chronological.at(-1).ev.name}: ${values.at(-1).toFixed(1)}% · ${deltaHTML(delta)}</div>
    </div>
    <div class="compare-card"><h3>Habilidades con seguimiento</h3>
      <div class="trend-list">${skills.length?skills.map(x=>`<div class="trend-row"><strong>${esc(x.tag)}</strong><div class="bar"><div style="width:${Math.max(0,Math.min(100,x.latest))}%"></div></div><div class="val">${x.latest.toFixed(1)}%<br>${deltaHTML(x.delta)}</div></div>`).join(''):'<div class="meta">Aún no hay habilidades repetidas entre evaluaciones.</div>'}</div>
    </div>
    <div class="compare-card"><h3>Contenidos con seguimiento</h3>
      <div class="trend-list">${contents.length?contents.map(x=>`<div class="trend-row"><strong>${esc(x.tag)}</strong><div class="bar"><div style="width:${Math.max(0,Math.min(100,x.latest))}%"></div></div><div class="val">${x.latest.toFixed(1)}%<br>${deltaHTML(x.delta)}</div></div>`).join(''):'<div class="meta">Aún no hay contenidos repetidos entre evaluaciones.</div>'}</div>
    </div>
    <div class="compare-card"><h3>Lectura rápida</h3>
      <div class="alert-list">
        <div class="alert-item ${delta!==null&&delta<0?'bad':'good'}"><span>Variación global</span><strong>${deltaHTML(delta)}</strong></div>
        <div class="alert-item"><span>Evaluaciones comparadas</span><strong>${rows.length}</strong></div>
      </div>
    </div>
  </div>`;
}

function openStudentHistory(studentId){
  const s=state.students.find(x=>x.id===studentId);if(!s)return;
  const person=s.personId?personById(s.personId):null;
  const personEnrollments=person?enrollmentsForPerson(person.id).slice().sort((a,b)=>(b.year||0)-(a.year||0)):[];

  const rows=studentAllResultRows(s);
  const avg=rows.length?rows.reduce((a,r)=>a+r.percent,0)/rows.length:0;
  const graded=rows.filter(r=>r.grade!==null);
  const avgGrade=graded.length?graded.reduce((a,r)=>a+r.grade,0)/graded.length:null;
  const courseSet=new Set(rows.map(r=>r.ev.courseId));
  $('#studentHistoryContent').innerHTML=`
    <div style="margin-bottom:14px"><strong style="font-size:18px">${esc(`${person?.firstName||s.firstName||''} ${person?.lastName||s.lastName||''}`.trim())}</strong><div class="meta">${esc(person?.run||s.run||'Sin RUN')} · ${rows.length} evaluaciones registradas ${person?'<span class="person-badge">Identidad longitudinal</span>':''}</div></div>
    <div class="history-grid">
      <div class="history-stat"><span>Evaluaciones</span><strong>${rows.length}</strong></div>
      <div class="history-stat"><span>Logro promedio</span><strong>${rows.length?avg.toFixed(1)+'%':'—'}</strong></div>
      <div class="history-stat"><span>Nota promedio</span><strong>${avgGrade===null?'—':avgGrade.toFixed(1)}</strong></div>
      <div class="history-stat"><span>Cursos con historial</span><strong>${courseSet.size}</strong></div>
    </div>
    ${personEnrollments.length?`<div class="enrollment-list">${personEnrollments.map(en=>{
      const c=courseById(en.courseId);
      return `<div class="enrollment-row"><div><span class="year">${en.year||c?.year||'—'}</span> <strong>${esc(courseName(c))}</strong></div><span class="chip">${en.status==='active'?'Matrícula registrada':esc(en.status||'Registrada')}</span></div>`;
    }).join('')}</div>`:''}
    ${rows.length>=2?renderStudentComparativeHTML(rows):''}
    <div style="overflow:auto;margin-top:14px">${rows.length?`<table class="history-table"><thead><tr><th>Fecha</th><th>Evaluación</th><th>Curso</th><th>Forma</th><th>Logro</th><th>Nota</th><th></th></tr></thead><tbody>
      ${rows.map(r=>`<tr>
        <td>${dateCL(r.ev.date)}</td>
        <td><strong>${esc(r.ev.name)}</strong></td>
        <td>${esc(courseName(courseById(r.ev.courseId)))}</td>
        <td>${esc(r.form||'—')}</td>
        <td><div class="progress-line"><div class="bar"><div style="width:${Math.max(0,Math.min(100,r.percent))}%"></div></div><strong>${r.percent.toFixed(1)}%</strong></div></td>
        <td>${r.grade===null?'—':r.grade.toFixed(1)}</td>
        <td><button class="secondary small" onclick="closeModal('studentHistoryModal');goToEvaluationResults('${r.ev.id}');setTimeout(()=>{resultsScope='student';renderResults();const sel=$('#resultsStudent');if(sel&&[...sel.options].some(o=>o.value==='${r.student?.id||studentId}')){sel.value='${r.student?.id||studentId}';renderResults()}},20)">Ver</button></td>
      </tr>`).join('')}
    </tbody></table>`:'<div class="empty">Todavía no hay resultados guardados para este estudiante.</div>'}</div>`;
  openModal('studentHistoryModal');
}

function trendDelta(values){
  if(values.length<2)return null;
  return values[values.length-1]-values[0];
}
function deltaHTML(delta){
  if(delta===null)return '<span class="delta flat">Sin comparación</span>';
  const cls=delta>1?'up':delta<-1?'down':'flat';
  const sign=delta>0?'+':'';
  return `<span class="delta ${cls}">${sign}${delta.toFixed(1)} pts.</span>`;
}
function courseSkillTrend(courseId){
  const evals=state.evaluations.filter(e=>e.courseId===courseId).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const map=new Map();
  evals.forEach(ev=>{
    const rows=resultRowsForEvaluation(ev.id);
    if(!rows.length)return;
    aggregateByTag(ev,rows,'skill').forEach(x=>{
      if(x.tag.startsWith('Sin '))return;
      if(!map.has(x.tag))map.set(x.tag,[]);
      map.get(x.tag).push({eid:ev.id,date:ev.date||'',name:ev.name,pct:x.pct});
    });
  });
  return [...map.entries()].map(([tag,vals])=>({tag,vals,delta:trendDelta(vals.map(v=>v.pct)),latest:vals.at(-1)?.pct??0}))
    .filter(x=>x.vals.length>=2).sort((a,b)=>a.latest-b.latest);
}
function courseContentTrend(courseId){
  const evals=state.evaluations.filter(e=>e.courseId===courseId).sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const map=new Map();
  evals.forEach(ev=>{
    const rows=resultRowsForEvaluation(ev.id);
    if(!rows.length)return;
    aggregateByTag(ev,rows,'content').forEach(x=>{
      if(x.tag.startsWith('Sin '))return;
      if(!map.has(x.tag))map.set(x.tag,[]);
      map.get(x.tag).push({eid:ev.id,date:ev.date||'',name:ev.name,pct:x.pct});
    });
  });
  return [...map.entries()].map(([tag,vals])=>({tag,vals,delta:trendDelta(vals.map(v=>v.pct)),latest:vals.at(-1)?.pct??0}))
    .filter(x=>x.vals.length>=2).sort((a,b)=>a.latest-b.latest);
}
function renderSpark(vals){
  if(!vals?.length)return '<div class="meta">Sin datos</div>';
  return `<div class="spark">${vals.map((v,i)=>`<span style="height:${Math.max(6,Math.min(100,v.pct))}%"><em>${i+1}</em></span>`).join('')}</div>`;
}
function renderCourseComparativeHTML(courseId,completed){
  const chronological=completed.slice().sort((a,b)=>(a.e.date||'').localeCompare(b.e.date||''));
  const avgs=chronological.map(x=>x.st.avg);
  const overallDelta=trendDelta(avgs);
  const skills=courseSkillTrend(courseId).slice(0,6);
  const contents=courseContentTrend(courseId).slice(0,6);
  return `<article class="panel" style="margin-top:14px">
    <div class="panel-head"><div><h3>Comparación longitudinal del curso</h3><p>Evolución entre evaluaciones guardadas.</p></div></div>
    <div class="history-grid">
      <div class="history-stat"><span>Primera evaluación</span><strong>${avgs[0].toFixed(1)}%</strong></div>
      <div class="history-stat"><span>Última evaluación</span><strong>${avgs.at(-1).toFixed(1)}%</strong></div>
      <div class="history-stat"><span>Variación</span><strong>${deltaHTML(overallDelta)}</strong></div>
      <div class="history-stat"><span>Evaluaciones comparadas</span><strong>${chronological.length}</strong></div>
    </div>
    <div class="compare-grid">
      <div class="compare-card"><h3>Evolución del logro del curso</h3>${renderSpark(chronological.map(x=>({pct:x.st.avg,name:x.e.name,date:x.e.date})))}
        <div class="meta">1 = evaluación más antigua · ${chronological.length} = más reciente</div>
      </div>
      <div class="compare-card"><h3>Habilidades con seguimiento</h3>
        <div class="trend-list">${skills.length?skills.map(x=>`<div class="trend-row"><strong>${esc(x.tag)}</strong><div class="bar"><div style="width:${Math.max(0,Math.min(100,x.latest))}%"></div></div><div class="val">${x.latest.toFixed(1)}%<br>${deltaHTML(x.delta)}</div></div>`).join(''):'<div class="meta">Se necesitan al menos dos evaluaciones con la misma habilidad etiquetada.</div>'}</div>
      </div>
      <div class="compare-card"><h3>Contenidos con seguimiento</h3>
        <div class="trend-list">${contents.length?contents.map(x=>`<div class="trend-row"><strong>${esc(x.tag)}</strong><div class="bar"><div style="width:${Math.max(0,Math.min(100,x.latest))}%"></div></div><div class="val">${x.latest.toFixed(1)}%<br>${deltaHTML(x.delta)}</div></div>`).join(''):'<div class="meta">Se necesitan al menos dos evaluaciones con el mismo contenido etiquetado.</div>'}</div>
      </div>
      <div class="compare-card"><h3>Lectura rápida</h3>
        <div class="alert-list">
          <div class="alert-item ${overallDelta!==null&&overallDelta<0?'bad':'good'}"><span>Variación global</span><strong>${deltaHTML(overallDelta)}</strong></div>
          <div class="alert-item"><span>Habilidades comparables</span><strong>${skills.length}</strong></div>
          <div class="alert-item"><span>Contenidos comparables</span><strong>${contents.length}</strong></div>
        </div>
      </div>
    </div>
  </article>`;
}


function updateEvaluationCreateButtons(inCourse=false){
  const globalBtn=$('#globalNewEvaluation');
  if(globalBtn)globalBtn.classList.toggle('hidden',!!inCourse);
}


function cleanupPersonIfUnused(personId){
  if(!personId)return;
  const hasStudent=state.students.some(s=>s.personId===personId);
  const hasEnrollment=state.enrollments.some(e=>e.personId===personId);
  if(!hasStudent&&!hasEnrollment)state.persons=state.persons.filter(p=>p.id!==personId);
}
async function deleteStudentFromCourse(studentId){
  const s=state.students.find(x=>x.id===studentId);if(!s)return;
  const course=courseById(s.courseId);
  const evalIds=new Set(state.evaluations.filter(e=>e.courseId===s.courseId).map(e=>e.id));
  const relatedResults=state.results.filter(r=>evalIds.has(r.evaluationId)&&r.omr?.studentMatch?.studentId===studentId);
  const name=`${s.firstName||''} ${s.lastName||''}`.trim()||s.run||'Estudiante';

  if(relatedResults.length){
    const typed=prompt(`“${name}” tiene ${relatedResults.length} resultado(s) guardado(s) en este curso.\n\nSi lo eliminas del curso también se borrarán esos resultados y sus evidencias. El historial de otros años/cursos se conservará.\n\nEscribe ELIMINAR para confirmar.`);
    if(typed!=='ELIMINAR')return;
  }else{
    if(!confirm(`¿Eliminar a “${name}” de ${courseName(course)}?\n\nSi tiene historial en otros años o cursos, ese historial se conservará.`))return;
  }

  const labels=new Set(relatedResults.map(r=>r.label).filter(Boolean));
  for(const r of relatedResults)await evidenceDelete(r.evidenceKey||r.key);

  state.results=state.results.filter(r=>!relatedResults.some(x=>x.key===r.key));
  state.review=state.review.filter(r=>!labels.has(r.file));
  state.scanPages=(state.scanPages||[]).filter(p=>!labels.has(p.label));
  state.enrollments=state.enrollments.filter(e=>e.studentId!==studentId);
  state.students=state.students.filter(x=>x.id!==studentId);
  cleanupPersonIfUnused(s.personId);

  logActivity('student_removed',`${name} · ${courseName(course)}`,{courseId:s.courseId,personId:s.personId});
  persist();renderReview();renderScan();renderResults();renderStats();
  if(courseById(s.courseId))openCourse(s.courseId);else renderCourses();
}
async function deleteCourse(courseId){
  const course=courseById(courseId);if(!course)return;
  const students=state.students.filter(s=>s.courseId===courseId);
  const evals=state.evaluations.filter(e=>e.courseId===courseId);
  const evalIds=new Set(evals.map(e=>e.id));
  const results=state.results.filter(r=>evalIds.has(r.evaluationId));
  const hasData=students.length||evals.length||results.length;

  const warning=`Eliminar “${courseName(course)}” (${course.year}) eliminará:\n• ${students.length} estudiante(s) de este curso\n• ${evals.length} evaluación(es)\n• ${results.length} resultado(s) y sus evidencias\n\nLos historiales vinculados de esos estudiantes en otros años/cursos se conservarán.`;
  if(hasData){
    const typed=prompt(`${warning}\n\nEscribe ELIMINAR para confirmar.`);
    if(typed!=='ELIMINAR')return;
  }else if(!confirm(`¿Eliminar “${courseName(course)}” (${course.year})?`))return;

  const labels=new Set(results.map(r=>r.label).filter(Boolean));
  for(const r of results)await evidenceDelete(r.evidenceKey||r.key);

  const personIds=[...new Set(students.map(s=>s.personId).filter(Boolean))];
  state.results=state.results.filter(r=>!evalIds.has(r.evaluationId));
  state.review=state.review.filter(r=>!evalIds.has(r.evaluationId)&&!labels.has(r.file));
  state.scanPages=(state.scanPages||[]).filter(p=>p.omr?.courseId!==courseId&&!labels.has(p.label));
  state.activity=state.activity.filter(a=>!evalIds.has(a.meta?.evaluationId));
  state.evaluations=state.evaluations.filter(e=>e.courseId!==courseId);
  state.enrollments=state.enrollments.filter(e=>e.courseId!==courseId);
  state.students=state.students.filter(s=>s.courseId!==courseId);
  state.courses=state.courses.filter(c=>c.id!==courseId);
  personIds.forEach(cleanupPersonIfUnused);

  logActivity('course_deleted',`${courseName(course)} · ${course.year}`,{courseId,year:course.year});
  if(state.activeCourseId===courseId)state.activeCourseId=null;
  persist();
  updateEvaluationCreateButtons(false);
  renderCourses();renderCalendar();renderEvaluations();renderDashboard();renderReview();renderScan();renderResults();renderStats();renderSettings();
}

function openCourse(id){
  state.activeCourseId=id;
  updateEvaluationCreateButtons(true);
  const c=courseById(id);if(!c)return;
  $('#courseBrowser').classList.add('hidden');$('#courseDetail').classList.remove('hidden');
  const students=state.students.filter(s=>s.courseId===id).sort((a,b)=>(a.lastName||'').localeCompare(b.lastName||'','es'));
  const evals=state.evaluations.filter(e=>e.courseId===id&&!e.archived).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const completed=evals.map(e=>({e,st:courseEvaluationStats(e)})).filter(x=>x.st);
  const totalResults=completed.reduce((a,x)=>a+x.st.count,0);
  const courseAvg=totalResults?completed.reduce((a,x)=>a+x.st.avg*x.st.count,0)/totalResults:null;

  $('#courseDetail').innerHTML=`
    <div class="course-detail-head">
      <div><button class="secondary small" onclick="updateEvaluationCreateButtons(false);renderCourses()">← Cursos</button>
        <h2>${esc(c.level)} ${esc(c.letter)} — ${esc(c.subject)}</h2>
        <div class="meta">Año ${c.year} · ${students.length} estudiantes · ${evals.length} evaluaciones</div>
      </div>
      <div style="display:flex;gap:7px;flex-wrap:wrap"><button class="primary" onclick="prefillEvaluationForCourse('${c.id}')">+ Evaluación</button><button class="danger" onclick="deleteCourse('${c.id}')">Eliminar curso</button></div>
    </div>

    <div class="history-grid" style="margin-bottom:14px">
      <div class="history-stat"><span>Evaluaciones con resultados</span><strong>${completed.length}</strong></div>
      <div class="history-stat"><span>Hojas corregidas guardadas</span><strong>${totalResults}</strong></div>
      <div class="history-stat"><span>Logro acumulado</span><strong>${courseAvg===null?'—':courseAvg.toFixed(1)+'%'}</strong></div>
    </div>

    <div class="grid2">
      <article class="panel">
        <div class="panel-head"><div><h3>Estudiantes</h3><p>Importación y acceso al historial individual.</p></div></div>
        <div class="import-box"><div class="student-actions"><label class="primary small">Importar planilla<input type="file" id="studentImport" accept=".xlsx,.xls,.csv"></label><button class="secondary small" onclick="openManualStudentModal('${id}')">+ Agregar estudiante</button><button class="secondary small" onclick="openPreviousStudentModal('${id}')">Importar desde historial</button></div><span class="meta"> Columnas reconocidas: RUN/RUT, Nombres/Nombre, Apellidos/Apellido.</span></div>
        <div style="overflow:auto;margin-top:12px">${students.length?`<table class="student-table"><thead><tr><th>RUN</th><th>Nombre</th><th>Apellidos</th><th></th></tr></thead><tbody>${students.map(s=>{const previous=s.personId?enrollmentsForPerson(s.personId).filter(e=>e.courseId!==id).length:0;return `<tr><td>${esc(s.run)}</td><td>${esc(s.firstName)}</td><td>${esc(s.lastName)} ${previous?`<span class="person-badge">${previous} registro(s) histórico(s)</span>`:''}</td><td><div class="student-row-actions"><button class="secondary small" onclick="openStudentHistory('${s.id}')">Historial</button><button class="danger small" onclick="deleteStudentFromCourse('${s.id}')">Eliminar</button></div></td></tr>`}).join('')}</tbody></table>`:'<div class="empty">Aún no hay estudiantes.</div>'}</div>
      </article>

      <article class="panel">
        <div class="panel-head"><div><h3>Evaluaciones del curso</h3><p>Historial, próximas pruebas y acceso directo a resultados.</p></div></div>
        ${evals.length?`<div class="list">${evals.map(e=>{const st=courseEvaluationStats(e);return `<div class="list-item"><div style="flex:1"><h4>${esc(e.name)}</h4><div class="meta">${dateCL(e.date)} · ${esc(e.unit||'Sin unidad')}</div><div class="chips"><span class="chip ${e.type==='formativa'?'formative':'summative'}">${e.type}</span><span class="status ${e.status}">${e.status}</span>${st?`<span class="chip">${st.count} resultados</span><span class="chip">${st.avg.toFixed(1)}% logro</span>`:''}</div></div><div style="display:flex;gap:6px;flex-wrap:wrap">${st?`<button class="secondary small" onclick="goToEvaluationResults('${e.id}')">Resultados</button>`:''}<button class="secondary small" onclick="openEditor('${e.id}')">Configurar</button></div></div>`}).join('')}</div>`:'<div class="empty">Sin evaluaciones.</div>'}
      </article>
    </div>

    ${completed.length?`<article class="panel" style="margin-top:14px">
      <div class="panel-head"><div><h3>Historial de desempeño del curso</h3><p>Las evaluaciones permanecen disponibles aunque hayas vaciado el lote de escaneo.</p></div></div>
      <div style="overflow:auto"><table class="history-table"><thead><tr><th>Fecha</th><th>Evaluación</th><th>Evaluados</th><th>Logro promedio</th><th>Nota promedio</th><th>Aprobación</th><th></th></tr></thead><tbody>
      ${completed.map(({e,st})=>`<tr><td>${dateCL(e.date)}</td><td><strong>${esc(e.name)}</strong></td><td>${st.count}</td><td><div class="progress-line"><div class="bar"><div style="width:${Math.max(0,Math.min(100,st.avg))}%"></div></div><strong>${st.avg.toFixed(1)}%</strong></div></td><td>${st.avgGrade===null?'—':st.avgGrade.toFixed(1)}</td><td>${st.pass===null?'—':st.pass.toFixed(0)+'%'}</td><td><button class="secondary small" onclick="goToEvaluationResults('${e.id}')">Abrir</button></td></tr>`).join('')}
      </tbody></table></div>
    </article>`:''}

    ${completed.length>=2?renderCourseComparativeHTML(id,completed):''}`;

  setTimeout(()=>{const inp=$('#studentImport');if(inp)inp.onchange=e=>importStudents(e.target.files[0],id)},0)
}

let pendingStudentCourseId=null;

function openManualStudentModal(courseId){
  pendingStudentCourseId=courseId;
  $('#studentAddForm').reset();
  $('#manualStudentHistoryPreview').innerHTML='';
  openModal('studentAddModal');
  setTimeout(()=>$('#manualStudentRun')?.focus(),0);
}
function updateManualStudentHistoryPreview(){
  const run=$('#manualStudentRun')?.value||'';
  const person=bestExistingPersonByRun(run);
  const box=$('#manualStudentHistoryPreview');if(!box)return;
  if(!person){box.innerHTML='';return}
  const h=personHistorySummary(person);
  box.innerHTML=`<div class="history-match">
    <strong>Se encontraron datos anteriores para este RUN</strong>
    <div>${esc(`${person.firstName||''} ${person.lastName||''}`.trim())} · ${esc(person.run||'')}</div>
    <div class="trail">${esc(h.text)}${h.resultCount?` · ${h.resultCount} resultado(s) guardado(s)`:''}</div>
    <div class="meta" style="margin-top:5px">Al guardar, podrás decidir si deseas conservar y vincular este historial.</div>
  </div>`;
}
function confirmHistoryLink(person,run){
  if(!person)return false;
  const h=personHistorySummary(person);
  return confirm(`El RUN ${run} ya existe en datos anteriores.\n\n${person.firstName||''} ${person.lastName||''}\n${h.text}\n${h.resultCount} resultado(s) guardado(s).\n\n¿Deseas conservar esos datos y vincular este estudiante al historial anterior?\n\nAceptar = conservar historial\nCancelar = agregarlo como registro independiente.`);
}
function addManualStudent(){
  const courseId=pendingStudentCourseId;
  const run=normalizeRun($('#manualStudentRun').value);
  const first=$('#manualStudentFirst').value.trim();
  const last=$('#manualStudentLast').value.trim();
  if(!courseId||!run||!first||!last)return alert('Completa RUN, nombres y apellidos.');
  if(state.students.some(s=>s.courseId===courseId&&personRunKey(s.run)===personRunKey(run)))return alert('Ese RUN ya está registrado en este curso.');
  const existing=bestExistingPersonByRun(run);
  let person;
  if(existing && confirmHistoryLink(existing,run)){
    person=existing;
    person.firstName=first||person.firstName;person.lastName=last||person.lastName;person.run=run||person.run;
  }else if(existing){
    person=createIndependentPerson(run,first,last);
  }else{
    person=findOrCreatePerson(run,first,last);
  }
  createRosterStudent(person,courseId);
  logActivity('enrollment_imported',`${first} ${last} · ${run}`,{courseId,personId:person.id,linkedHistory:person===existing});
  persist();closeModal('studentAddModal');openCourse(courseId);
}
function previousPeopleForCourse(courseId){
  const currentPersonIds=new Set(state.students.filter(s=>s.courseId===courseId).map(s=>s.personId).filter(Boolean));
  return state.persons.filter(p=>!currentPersonIds.has(p.id)&&enrollmentsForPerson(p.id).length)
    .sort((a,b)=>(a.lastName||'').localeCompare(b.lastName||'','es'));
}
function openPreviousStudentModal(courseId){
  pendingStudentCourseId=courseId;
  $('#previousStudentSearch').value='';
  renderPreviousStudentList();
  openModal('previousStudentModal');
}
function renderPreviousStudentList(){
  const box=$('#previousStudentList');if(!box)return;
  const q=($('#previousStudentSearch')?.value||'').toLowerCase();
  const rows=previousPeopleForCourse(pendingStudentCourseId).filter(p=>`${p.run} ${p.firstName} ${p.lastName}`.toLowerCase().includes(q));
  box.innerHTML=rows.length?rows.map(p=>{
    const h=personHistorySummary(p);
    return `<div class="previous-option">
      <div><strong>${esc(`${p.lastName||''} ${p.firstName||''}`.trim())}</strong><div class="meta">${esc(p.run||'Sin RUN')}</div><div class="meta">${esc(h.text)}${h.resultCount?` · ${h.resultCount} resultado(s)`:''}</div></div>
      <button class="primary small" onclick="importPreviousPerson('${p.id}')">Agregar y conservar historial</button>
    </div>`;
  }).join(''):'<div class="empty">No hay estudiantes anteriores disponibles para este curso.</div>';
}
function importPreviousPerson(personId){
  const person=personById(personId),courseId=pendingStudentCourseId;if(!person||!courseId)return;
  createRosterStudent(person,courseId);
  logActivity('enrollment_imported',`${person.firstName||''} ${person.lastName||''} · historial conservado`,{courseId,personId:person.id,linkedHistory:true});
  persist();closeModal('previousStudentModal');openCourse(courseId);
}

function normalizeRun(v){return String(v??'').trim().toUpperCase().replace(/\./g,'').replace(/\s/g,'')}
function findVal(row,names){const keys=Object.keys(row);for(const n of names){const k=keys.find(k=>k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').includes(n));if(k&&row[k]!=null)return row[k]}return ''}
function rowsToStudents(rows,courseId){
  const prepared=rows.map(r=>({
    run:normalizeRun(findVal(r,['run','rut'])),
    first:String(findVal(r,['nombres','nombre'])).trim(),
    last:String(findVal(r,['apellidos','apellido paterno','apellido'])).trim()
  })).filter(x=>x.run||x.first||x.last);

  const matches=prepared.filter(x=>{
    if(!x.run)return false;
    const existing=bestExistingPersonByRun(x.run);
    return !!existing && !state.students.some(s=>s.courseId===courseId&&s.personId===existing.id);
  });

  let linkExisting=true;
  if(matches.length){
    linkExisting=confirm(`Se detectaron ${matches.length} estudiante(s) cuyo RUN ya tiene datos de años o cursos anteriores.\n\n¿Deseas conservar esos datos y vincular sus historiales?\n\nAceptar = conservar y vincular\nCancelar = importarlos como registros independientes.`);
  }

  let added=0,dupes=0,reused=0,separate=0;
  prepared.forEach(x=>{
    const existing=bestExistingPersonByRun(x.run);
    if(existing && state.students.some(s=>s.courseId===courseId&&s.personId===existing.id)){dupes++;return}
    let person;
    if(existing && linkExisting){
      person=existing;
      if(x.first)person.firstName=x.first;if(x.last)person.lastName=x.last;if(x.run)person.run=x.run;
      reused++;
    }else if(existing){
      person=createIndependentPerson(x.run,x.first,x.last);separate++;
    }else{
      person=findOrCreatePerson(x.run,x.first,x.last);
    }
    if(state.students.some(s=>s.courseId===courseId&&personRunKey(s.run)===personRunKey(x.run))){dupes++;return}
    createRosterStudent(person,courseId);added++;
  });
  persist();openCourse(courseId);
  alert(`Importación completada: ${added} estudiante(s) agregado(s)${reused?`, ${reused} vinculados a historial anterior`:''}${separate?`, ${separate} como registros independientes`:''}${dupes?`, ${dupes} duplicado(s) omitidos`:''}.`);
}
function parseCSV(text){const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());if(!lines.length)return[];const delim=(lines[0].split(';').length>lines[0].split(',').length)?';':',';const split=line=>{const out=[];let cur='',q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++}else q=!q}else if(ch===delim&&!q){out.push(cur);cur=''}else cur+=ch}out.push(cur);return out};const headers=split(lines[0]);return lines.slice(1).map(l=>{const vals=split(l),o={};headers.forEach((h,i)=>o[h.trim()]=vals[i]??'');return o})}
function importStudents(file,courseId){if(!file)return;const ext=file.name.split('.').pop().toLowerCase();const reader=new FileReader();reader.onload=e=>{try{let rows=[];if(ext==='csv')rows=parseCSV(e.target.result);else if(window.XLSX){const wb=XLSX.read(e.target.result,{type:'array'});rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''})}else{alert('No se pudo cargar el lector de Excel. Puedes guardar la planilla como CSV e importarla sin conexión.');return}rowsToStudents(rows,courseId)}catch(err){alert('No pude leer la planilla: '+err.message)}};if(ext==='csv')reader.readAsText(file);else reader.readAsArrayBuffer(file)}
function renderCalendar(){fillYearSelect($('#calendarYear'),$('#calendarYear').value||currentYear);fillCourseSelect($('#calendarCourse'),true,$('#calendarCourse').value);const year=Number($('#calendarYear').value)||currentYear,course=$('#calendarCourse').value;const ycfg=state.years.find(y=>y.year===year);const rows=state.evaluations.filter(e=>{const c=courseById(e.courseId);return c&&c.year===year&&(!course||e.courseId===course)}).sort((a,b)=>(a.date||'9999').localeCompare(b.date||'9999'));const groups={};rows.forEach(e=>(groups[monthKey(e.date)]??=[]).push(e));let html='';Object.entries(groups).forEach(([m,evs])=>{let title=m==='sin-fecha'?'Sin fecha':new Date(Number(m.slice(0,4)),Number(m.slice(5,7))-1,1).toLocaleDateString('es-CL',{month:'long',year:'numeric'});html+=`<div class="calendar-month"><h3>${esc(title)}</h3>${evs.map(e=>{const day=e.date?Number(e.date.slice(8,10)):'—',mon=e.date?new Date(Number(e.date.slice(0,4)),Number(e.date.slice(5,7))-1,1).toLocaleDateString('es-CL',{month:'short'}):'';return `<div class="calendar-item"><div class="datebox"><strong>${day}</strong><span>${mon}</span></div><div><strong>${esc(e.name)}</strong><div class="meta">${esc(courseName(courseById(e.courseId)))} · ${esc(e.unit||'Sin unidad')}</div><div class="chips"><span class="chip ${e.type==='formativa'?'formative':'summative'}">${e.type}</span><span class="status ${e.status}">${e.status}</span></div></div><div class="cal-actions"><button class="secondary small" onclick="openEditor('${e.id}')">Abrir</button></div></div>`}).join('')}</div>`});if(ycfg?.vacStart&&ycfg?.vacEnd)html+=`<div class="school-break">Vacaciones de invierno: ${dateCL(ycfg.vacStart)} – ${dateCL(ycfg.vacEnd)}</div>`;$('#calendarList').innerHTML=html||'<div class="empty">No hay evaluaciones agendadas para este filtro.</div>'}
function prefillEvaluationForCourse(courseId){fillCourseSelect($('#evCourse'),false,courseId);$('#evDate').value='';$('#evType').value='sumativa';openModal('evaluationModal')}
function openNewEvaluation(){fillCourseSelect($('#evCourse'),false,state.activeCourseId||'');$('#evaluationForm').reset();fillCourseSelect($('#evCourse'),false,state.activeCourseId||'');$('#evQuestions').value=36;$('#evChoices').value=4;$('#evType').value='sumativa';$('#evStatus').value='planificada';openModal('evaluationModal')}
function saveEvaluation(){const count=Math.max(1,Math.min(100,Number($('#evQuestions').value)||1)),forms=$('#evForms').value.split(',').map(x=>x.trim()).filter(Boolean),formNames=forms.length?forms:['Única'];const base=Array.from({length:count},(_,i)=>({n:i+1,itemId:`I${String(i+1).padStart(3,'0')}`,key:'A',points:1,active:true,skill:'',content:'',options:Array.from({length:Number($('#evChoices').value)||4},(_,j)=>String.fromCharCode(65+j))}));const ev={id:uid(),name:$('#evName').value.trim(),courseId:$('#evCourse').value,date:$('#evDate').value,type:$('#evType').value,status:$('#evStatus').value,unit:$('#evUnit').value.trim(),objective:$('#evObjective').value.trim(),choices:Number($('#evChoices').value),forms:formNames,formConfigs:{},grading:{...state.settings},createdAt:new Date().toISOString()};formNames.forEach(f=>ev.formConfigs[f]={items:cloneItems(base)});ev.questions=count;state.evaluations.unshift(ev);persist();closeModal('evaluationModal');renderEvaluations();renderCalendar();setTimeout(()=>openEditor(ev.id),0)}
function evaluationResultCount(id){return (state.results||[]).filter(r=>r.evaluationId===id).length}
function renderEvaluations(){
  const q=($('#evaluationSearch').value||'').toLowerCase(),t=$('#evaluationTypeFilter').value;
  const showArchived=$('#showArchivedEvaluations')?.checked===true;
  const rows=state.evaluations.filter(e=>(showArchived||!e.archived)&&(!t||e.type===t)&&`${e.name} ${courseName(courseById(e.courseId))} ${e.unit}`.toLowerCase().includes(q));
  $('#evaluationList').innerHTML=rows.length?rows.map(e=>{
    const rc=evaluationResultCount(e.id);
    return `<div class="list-item ${e.archived?'archived-item':''}"><div><h4>${esc(e.name)}</h4><div class="meta">${esc(courseName(courseById(e.courseId)))} · ${dateCL(e.date)} · ${e.forms.length} forma(s)</div>
      <div class="chips"><span class="chip ${e.type==='formativa'?'formative':'summative'}">${e.type}</span>${e.forms.map(f=>`<span class="chip">${esc(f)}</span>`).join('')}<span class="status ${e.status}">${e.status}</span>${rc?`<span class="chip">${rc} resultado(s)</span>`:''}${e.archived?'<span class="chip archive-badge">archivada</span>':''}</div></div>
      <div><button class="secondary small" onclick="openEditor('${e.id}')">Configurar</button>
      <button class="secondary small" onclick="toggleArchiveEvaluation('${e.id}')">${e.archived?'Restaurar':'Archivar'}</button>
      <button class="danger small" onclick="deleteEvaluation('${e.id}')">Eliminar</button></div></div>`;
  }).join(''):'<div class="empty">No hay evaluaciones.</div>';
}
function toggleArchiveEvaluation(id){
  const e=evalById(id);if(!e)return;
  e.archived=!e.archived;logActivity(e.archived?'evaluation_archived':'evaluation_restored',e.name,{evaluationId:e.id});persist();renderEvaluations();renderDashboard();renderCourses();
}
function deleteEvaluation(id){
  const e=evalById(id);if(!e)return;
  const rc=evaluationResultCount(id);
  if(rc){
    const first=prompt(`“${e.name}” tiene ${rc} resultado(s) guardado(s). Eliminarla borrará también esos resultados e historial.\\n\\nEscribe ELIMINAR para confirmar.`);
    if(first!=='ELIMINAR')return;
  }else if(!confirm(`Eliminar “${e.name}”? Esta acción no se puede deshacer.`))return;
  const evidenceKeys=state.results.filter(x=>x.evaluationId===id).map(x=>x.evidenceKey||x.key).filter(Boolean);
  evidenceKeys.forEach(k=>evidenceDelete(k));
  state.evaluations=state.evaluations.filter(x=>x.id!==id);
  state.results=state.results.filter(x=>x.evaluationId!==id);
  state.review=state.review.filter(x=>x.evaluationId!==id);
  persist();renderEvaluations();renderCalendar();renderDashboard();renderCourses();
}
function currentEv(){return evalById(state.editingId)}function currentForm(){const e=currentEv();return e&&e.forms.includes(state.editingForm)?state.editingForm:e?.forms[0]}function currentItems(){const e=currentEv(),f=currentForm();if(!e||!f)return[];ensureEvaluationQuestions(e);return Array.isArray(e.formConfigs?.[f]?.items)?e.formConfigs[f].items:[]}
function getMax(e,f){
  if(!e)return 0;
  ensureEvaluationQuestions(e);
  const form=f||e.forms?.[0];
  const items=e.formConfigs?.[form]?.items||[];
  return items.reduce((a,q)=>a+(q.active===false?0:Math.max(0,Number(q.points)||0)),0);
}
function grade(score,e,f){const max=getMax(e,f),s=Math.max(0,Math.min(Number(score)||0,max)),cut=max*(Number(e.grading.threshold)||60)/100;if(max<=0)return e.grading.minGrade;let g=s<=cut?Number(e.grading.minGrade)+(Number(e.grading.passGrade)-Number(e.grading.minGrade))*(s/(cut||1)):Number(e.grading.passGrade)+(Number(e.grading.maxGrade)-Number(e.grading.passGrade))*((s-cut)/(max-cut||1));return Math.round((g+Number.EPSILON)*10)/10}
function openEditor(id){const e=evalById(id);if(!e)return;ensureEvaluationQuestions(e);persist();state.editingId=id;state.editingForm=e.forms[0];showView('evaluations',true);$('#evaluationBrowser').classList.add('hidden');$('#evaluationEditor').classList.remove('hidden');$('#editorName').textContent=e.name;$('#editName').value=e.name||'';$('#editorMeta').textContent=`${courseName(courseById(e.courseId))} · ${dateCL(e.date)} · ${e.forms.length} forma(s)`;$('#editUnit').value=e.unit||'';$('#editObjective').value=e.objective||'';$('#editType').value=e.type;$('#editDate').value=e.date||'';$('#editStatus').value=e.status;$('#editThreshold').value=e.grading.threshold;$('#editMinGrade').value=e.grading.minGrade;$('#editPassGrade').value=e.grading.passGrade;$('#editMaxGrade').value=e.grading.maxGrade;$('#newFormName').value='';renderFormTabs();renderScoringLock();renderQuestionRows();updateEditor()}
function closeEditor(){if(state.editingId)scoringUnlocked.delete(state.editingId);state.editingId=null;state.editingForm=null;$('#evaluationEditor').classList.add('hidden');$('#evaluationBrowser').classList.remove('hidden')}
function renderFormTabs(){const e=currentEv();if(!e)return;$('#formTabs').innerHTML=e.forms.map(f=>`<button class="form-tab ${f===currentForm()?'active':''}" onclick="selectForm('${f.replace(/'/g,"\\'")}')">${esc(f)}</button>`).join('');$('#currentFormLabel').textContent=currentForm();$('#copyFromForm').innerHTML=e.forms.filter(f=>f!==currentForm()).map(f=>`<option value="${esc(f)}">Copiar desde ${esc(f)}</option>`).join('');$('#copyForm').disabled=e.forms.length<2}
function selectForm(f){const e=currentEv();if(!e||!e.forms.includes(f))return;state.editingForm=f;$('#newFormName').value='';renderFormTabs();renderScoringLock();renderQuestionRows();updateEditor()}

function evaluationHasResults(e){return !!e && evaluationResultCount(e.id)>0}
function scoringLocked(e){return evaluationHasResults(e)&&!scoringUnlocked.has(e.id)}
function renderScoringLock(){
  const e=currentEv(),box=$('#scoringLockBanner');if(!box||!e)return;
  const locked=scoringLocked(e);['applyFormQuestionCount','applyFormChoiceCount','formChoiceCount','repairQuestions','allOnePoint','deleteCurrentForm','copyForm'].forEach(id=>{const el=$('#'+id);if(el)el.disabled=locked});
  const count=evaluationResultCount(e.id);
  if(!count){box.innerHTML='';return}
  if(scoringLocked(e)){
    box.innerHTML=`<div class="data-warning"><div><strong>Esta evaluación ya tiene ${count} resultado(s) guardado(s).</strong><div class="meta">La clave, puntajes, anulación de preguntas y cantidad de ítems están protegidos para evitar cambios accidentales. Habilidad, contenido, nombre, unidad y fecha siguen siendo editables.</div></div><button class="secondary small" onclick="unlockScoring('${e.id}')">Habilitar edición de corrección</button></div>`;
  }else{
    box.innerHTML=`<div class="data-warning"><div><strong>Edición de corrección habilitada.</strong><div class="meta">Los cambios en claves, puntajes o preguntas recalcularán los resultados ya guardados.</div></div><button class="secondary small" onclick="lockScoring('${e.id}')">Volver a proteger</button></div>`;
  }
}
function unlockScoring(id){
  const e=evalById(id);if(!e)return;
  if(!confirm(`Esta evaluación tiene ${evaluationResultCount(id)} resultado(s). Los cambios en clave, puntajes o preguntas recalcularán esos resultados. ¿Habilitar edición?`))return;
  scoringUnlocked.add(id);logActivity('scoring_unlocked',e.name,{evaluationId:e.id});persist();renderScoringLock();renderQuestionRows();updateEditor();
}
function lockScoring(id){scoringUnlocked.delete(id);renderScoringLock();renderQuestionRows();updateEditor()}

function formChoiceCount(e=currentEv(),f=currentForm()){
  const items=e?.formConfigs?.[f]?.items||[];
  if(!items.length)return Math.min(4,Math.max(2,Number(e?.choices)||4));
  return Math.min(4,Math.max(2,Math.max(...items.map(q=>(q.options||[]).length||0))));
}
function renderQuestionRows(){
  const e=currentEv();if(!e)return;
  ensureEvaluationQuestions(e);
  const body=$('#questionRows');body.innerHTML='';
  const items=currentItems();
  const locked=scoringLocked(e);
  $('#formQuestionCount').value=items.length;
  if($('#formChoiceCount'))$('#formChoiceCount').value=String(formChoiceCount(e,currentForm()));
  if(!items.length){body.innerHTML='<tr><td colspan="6"><div class="empty">No se pudieron generar las preguntas de esta forma.</div></td></tr>';return}
  items.forEach((q,i)=>{
    if(!Array.isArray(q.options)||q.options.length<2)q.options=defaultOptionsFor(e).slice(0,4);
    q.options=q.options.filter(x=>['A','B','C','D'].includes(x));
    if(!q.options.includes(q.key))q.key=q.options[0];
    const tr=document.createElement('tr');
    tr.classList.toggle('void',!q.active);
    const baseCount=formChoiceCount(e,currentForm());
    const allLetters=['A','B','C','D'].slice(0,baseCount);
    const optionsHtml=allLetters.map(l=>{
      const active=q.options.includes(l), correct=q.key===l;
      if(!active){
        return `<span class="option-wrap"><button type="button" class="opt-btn inactive" data-option-restore="${l}" data-question="${i}" ${q.active&&!locked?'':'disabled'} title="Restaurar alternativa ${l}">+${l}</button></span>`;
      }
      return `<span class="option-wrap"><button type="button" class="opt-btn ${correct?'correct':''}" data-key-option="${l}" data-question="${i}" ${q.active&&!locked?'':'disabled'} title="Marcar ${l} como respuesta correcta">${l}</button>${q.options.length>2&&!locked&&q.active?`<button type="button" class="opt-remove" data-option-remove="${l}" data-question="${i}" title="Quitar alternativa ${l}">×</button>`:''}</span>`;
    }).join('');
    tr.innerHTML=`<td><strong>${i+1}</strong></td>
      <td><div class="option-set">${optionsHtml}</div></td>
      <td><input class="short pts" type="number" min="0" step="0.25" value="${q.points}" ${q.active&&!locked?'':'disabled'}></td>
      <td><input class="text skill" value="${esc(q.skill)}" placeholder="Ej. Analizar" ${q.active?'':'disabled'}></td>
      <td><input class="text content" value="${esc(q.content)}" placeholder="Ej. Guerra Fría" ${q.active?'':'disabled'}></td>
      <td class="actions-cell"><button class="icon-btn ${q.active?'':'restore'}" type="button" data-question-index="${i}" ${locked?'disabled':''} title="${q.active?'Anular pregunta':'Restaurar pregunta'}" aria-label="${q.active?'Anular pregunta':'Restaurar pregunta'}">${q.active?'🗑️':'↩︎'}</button></td>`;
    tr.querySelector('.pts').oninput=x=>{q.points=Math.max(0,Number(x.target.value)||0);recalcStoredResultsForEvaluation(e.id);updateEditor();persist()};
    tr.querySelector('.pts').onchange=x=>{q.points=Math.max(0,Number(x.target.value)||0);recalcStoredResultsForEvaluation(e.id);updateEditor();persist()};
    tr.querySelector('.skill').oninput=x=>{q.skill=x.target.value;persist()};
    tr.querySelector('.content').oninput=x=>{q.content=x.target.value;persist()};
    body.appendChild(tr)
  })
}
function toggleQuestionActive(index){
  const items=currentItems();
  const q=items[index];
  if(!q)return;
  if(q.active!==false){
    if(!confirm(`¿Anular la pregunta ${index+1}? Dejará de considerarse en el puntaje máximo y en la corrección.`))return;
    q.active=false;
  }else{
    q.active=true;
  }
  const e=currentEv();if(e)recalcStoredResultsForEvaluation(e.id);
  persist();
  renderQuestionRows();
  updateEditor();
}


function setQuestionKey(index,letter){
  const e=currentEv(),q=currentItems()[index];if(!e||!q||!q.options.includes(letter)||scoringLocked(e))return;
  q.key=letter;recalcStoredResultsForEvaluation(e.id);persist();renderQuestionRows();updateEditor();
}
function removeQuestionOption(index,letter){
  const e=currentEv(),q=currentItems()[index];if(!e||!q||scoringLocked(e))return;
  if(q.key===letter){alert('Esta alternativa es la respuesta correcta. Marca primero otra alternativa correcta y luego podrás quitarla.');return}
  if(q.options.length<=2){alert('Cada pregunta debe conservar al menos dos alternativas.');return}
  q.options=q.options.filter(x=>x!==letter);
  recalcStoredResultsForEvaluation(e.id);persist();renderQuestionRows();updateEditor();
}
function restoreQuestionOption(index,letter){
  const e=currentEv(),q=currentItems()[index];if(!e||!q||scoringLocked(e))return;
  if(!q.options.includes(letter)){q.options.push(letter);q.options.sort()}
  persist();renderQuestionRows();updateEditor();
}
function setCurrentFormChoiceCount(){
  const e=currentEv(),f=currentForm();if(!e||!f||scoringLocked(e))return;
  const n=Math.max(2,Math.min(4,Number($('#formChoiceCount').value)||4));
  const letters=['A','B','C','D'].slice(0,n);
  const cfg=e.formConfigs[f],invalid=cfg.items.filter(q=>!letters.includes(q.key)).length;
  if(invalid && !confirm(`${invalid} pregunta(s) tienen actualmente una clave fuera de ${letters.join('–')}. Al reducir las alternativas, esas claves se cambiarán temporalmente a ${letters[0]}. Luego puedes marcar la alternativa correcta directamente con los botones. ¿Continuar?`))return;
  cfg.items.forEach(q=>{
    q.options=letters.slice();
    if(!letters.includes(q.key))q.key=letters[0];
  });
  e.choices=Math.max(Number(e.choices)||0,n);
  recalcStoredResultsForEvaluation(e.id);persist();renderQuestionRows();updateEditor();
}
function setCurrentFormQuestionCount(){
  const e=currentEv(),f=currentForm(); if(!e||!f)return;
  const cfg=e.formConfigs[f],old=cfg.items.length;
  const n=Math.max(1,Math.min(100,Number($('#formQuestionCount').value)||old));
  if(n===old)return;
  if(n<old && !confirm(`La forma ${f} pasará de ${old} a ${n} preguntas. Se eliminará la configuración de las preguntas ${n+1} a ${old}. ¿Continuar?`)){ $('#formQuestionCount').value=old; return; }
  if(n<old) cfg.items=cfg.items.slice(0,n);
  else cfg.items=cfg.items.concat(makeBaseItems(n-old,e).map((q,j)=>({...q,n:old+j+1,itemId:`I${String(old+j+1).padStart(3,'0')}`})));
  cfg.items.forEach((q,i)=>q.n=i+1);
  recalcStoredResultsForEvaluation(e.id);persist();renderQuestionRows();updateEditor();
}

function canonicalItemIds(e){
  if(!e)return[];
  ensureEvaluationQuestions(e);
  const ref=e.forms[0], items=e.formConfigs?.[ref]?.items||[];
  const ids=[];
  items.forEach((q,i)=>{let id=(q.itemId||'').trim();if(!id){id=`I${String(i+1).padStart(3,'0')}`;q.itemId=id}if(!ids.includes(id))ids.push(id)});
  return ids;
}
function itemIndexById(e,form,itemId){return (e.formConfigs?.[form]?.items||[]).findIndex(q=>(q.itemId||'').trim()===itemId)}
function assignItemToPosition(e,form,itemId,newIndex){
  const items=e.formConfigs?.[form]?.items||[];
  if(newIndex<0||newIndex>=items.length)return;
  const oldIndex=itemIndexById(e,form,itemId);
  if(oldIndex===newIndex)return;
  const displaced=(items[newIndex].itemId||'').trim();
  items[newIndex].itemId=itemId;
  if(oldIndex>=0)items[oldIndex].itemId=displaced||`I${String(oldIndex+1).padStart(3,'0')}`;
  persist();
}
function renderEquivalenceMap(){
  const e=currentEv(); if(!e)return;
  ensureEvaluationQuestions(e);
  const ids=canonicalItemIds(e), ref=e.forms[0];
  $('#equivalenceHelp').innerHTML=`Forma de referencia: <strong>${esc(ref)}</strong>. Cambiar una posición intercambia los identificadores para evitar duplicados.`;
  $('#equivalenceHead').innerHTML='<tr><th>Ítem lógico</th>'+e.forms.map(f=>`<th>${esc(f)}</th>`).join('')+'</tr>';
  const body=$('#equivalenceRows'); body.innerHTML='';
  ids.forEach(id=>{
    const tr=document.createElement('tr');
    tr.innerHTML=`<td class="eq-id">${esc(id)}</td>`+e.forms.map(f=>{
      const items=e.formConfigs[f].items, idx=itemIndexById(e,f,id);
      return `<td><select data-form="${esc(f)}" data-item="${esc(id)}">`+
        `<option value="-1" ${idx<0?'selected':''}>— Sin asignar —</option>`+
        items.map((q,i)=>`<option value="${i}" ${i===idx?'selected':''}>Pregunta ${i+1}</option>`).join('')+
        `</select></td>`;
    }).join('');
    tr.querySelectorAll('select').forEach(sel=>sel.onchange=()=>{const f=sel.dataset.form, item=sel.dataset.item, idx=Number(sel.value);if(idx>=0){assignItemToPosition(e,f,item,idx);renderQuestionRows();renderEquivalenceMap()}else{const old=itemIndexById(e,f,item);if(old>=0)e.formConfigs[f].items[old].itemId=`LIBRE-${f}-${old+1}`;persist();renderQuestionRows();renderEquivalenceMap()}});
    body.appendChild(tr);
  });
}
function syncMetadataFromReference(){
  const e=currentEv();if(!e||e.forms.length<2)return;
  const ref=e.forms[0], refItems=e.formConfigs[ref].items;
  const byId=Object.fromEntries(refItems.map(q=>[(q.itemId||'').trim(),q]));
  e.forms.slice(1).forEach(f=>e.formConfigs[f].items.forEach(q=>{const src=byId[(q.itemId||'').trim()];if(src){q.skill=src.skill||'';q.content=src.content||''}}));
  persist();renderQuestionRows();alert('Habilidad y contenido sincronizados desde '+ref+'.');
}
function normalizeFormName(value){return String(value||'').trim();}
function addForm(){
  const e=currentEv(); if(!e)return;
  const name=normalizeFormName($('#newFormName').value);
  if(!name){alert('Escribe un nombre para la nueva forma.');return;}
  if(e.forms.some(f=>f.toLowerCase()===name.toLowerCase())){alert('Ya existe una forma con ese nombre.');return;}
  e.forms.push(name);
  e.formConfigs[name]={items:cloneItems(makeBaseItems(currentItems().length||e.questions||1,e),e)};
  state.editingForm=name;
  ensureEvaluationQuestions(e); persist();
  $('#newFormName').value='';
  $('#editorMeta').textContent=`${courseName(courseById(e.courseId))} · ${dateCL(e.date)} · ${e.forms.length} forma(s)`;
  renderFormTabs(); renderQuestionRows(); updateEditor(); renderEvaluations(); renderCalendar();
}
function deleteCurrentForm(){
  const e=currentEv(); if(!e)return;
  const f=currentForm();
  if(e.forms.length<=1){alert('La evaluación debe conservar al menos una forma.');return;}
  if(!confirm(`¿Eliminar la forma “${f}”? Se perderán su clave, puntajes, habilidades y contenidos configurados.`))return;
  delete e.formConfigs[f];
  e.forms=e.forms.filter(x=>x!==f);
  state.editingForm=e.forms[0];
  $('#editorMeta').textContent=`${courseName(courseById(e.courseId))} · ${dateCL(e.date)} · ${e.forms.length} forma(s)`;
  persist();
  renderFormTabs(); renderQuestionRows(); updateEditor(); renderEvaluations(); renderCalendar();
}

function normHeader(s){return String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim().replace(/[^a-z0-9]/g,'')}
function pickField(row,names){
  const wanted=names.map(normHeader); for(const [k,v] of Object.entries(row||{})){if(wanted.includes(normHeader(k)))return v} return '';
}
function parseOptionsValue(v,e){
  if(v===undefined||v===null||String(v).trim()==='')return null;
  const allowed=defaultOptionsFor(e);
  const chars=String(v).toUpperCase().match(/[A-E]/g)||[];
  const uniq=[...new Set(chars)].filter(x=>allowed.includes(x));
  return uniq.length>=2?uniq:null;
}
function importRowsToForm(rows,e,form){
  if(!Array.isArray(rows)||!rows.length)return 0;
  let maxN=0,count=0;
  rows.forEach((row,idx)=>{const rawN=pickField(row,['Pregunta','N','N°','Numero','Número']); const n=Math.max(1,Number(rawN)||idx+1); maxN=Math.max(maxN,n)});
  if(maxN<1)return 0;
  const old=e.formConfigs[form]?.items||[];
  if(old.length<maxN)e.formConfigs[form].items=old.concat(makeBaseItems(maxN-old.length,e).map((q,j)=>({...q,n:old.length+j+1})));
  else if(old.length>maxN)e.formConfigs[form].items=old.slice(0,maxN);
  const items=e.formConfigs[form].items;
  rows.forEach((row,idx)=>{
    const rawN=pickField(row,['Pregunta','N','N°','Numero','Número']); const n=Math.max(1,Number(rawN)||idx+1); if(n>items.length)return;
    const q=items[n-1];
    const opts=parseOptionsValue(pickField(row,['Alternativas','Opciones','Distractores']),e); if(opts)q.options=opts;
    const key=String(pickField(row,['Clave','Respuesta','Correcta','Alternativa correcta'])||'').trim().toUpperCase();
    if(key && q.options.includes(key))q.key=key;
    const p=pickField(row,['Puntaje','Puntos','Valor']); if(p!==''&&!Number.isNaN(Number(p)))q.points=Math.max(0,Number(p));
    const sk=pickField(row,['Habilidad','Skill']); if(sk!=='')q.skill=String(sk).trim();
    const co=pickField(row,['Contenido','Tema','Content']); if(co!=='')q.content=String(co).trim();
    count++;
  });
  e.questions=Math.max(Number(e.questions)||1,maxN);
  return count;
}
async function importTestConfig(file){
  const e=currentEv(); if(!file||!e)return;
  const ext=file.name.split('.').pop().toLowerCase();
  try{
    if(ext==='csv'){
      const rows=parseCSV(await file.text()); importRowsToForm(rows,e,currentForm());
    }else{
      if(!window.XLSX){alert('No se pudo cargar el lector de Excel. Guarda la planilla como CSV o prueba con conexión a Internet.');return}
      const buf=await file.arrayBuffer(), wb=XLSX.read(buf,{type:'array'});
      let imported=0;
      const sheetNames=wb.SheetNames;
      // 1) Hojas cuyo nombre coincide con una forma
      sheetNames.forEach(sn=>{const f=e.forms.find(x=>x.toLowerCase()===sn.trim().toLowerCase()); if(f){const rows=XLSX.utils.sheet_to_json(wb.Sheets[sn],{defval:''}); imported+=importRowsToForm(rows,e,f)}});
      // 2) Si no hubo coincidencias, usar columna Forma en la primera hoja; si no existe, importar a forma actual
      if(imported===0&&sheetNames.length){const rows=XLSX.utils.sheet_to_json(wb.Sheets[sheetNames[0]],{defval:''}); const grouped={}; let hasForm=false;
        rows.forEach(r=>{const fv=String(pickField(r,['Forma','Version','Versión'])||'').trim(); if(fv){hasForm=true; const f=e.forms.find(x=>x.toLowerCase()===fv.toLowerCase()); if(f)(grouped[f]??=[]).push(r)}});
        if(hasForm){Object.entries(grouped).forEach(([f,rs])=>imported+=importRowsToForm(rs,e,f))}else imported+=importRowsToForm(rows,e,currentForm());
      }
    }
    ensureEvaluationQuestions(e);persist();renderFormTabs();renderQuestionRows();updateEditor();alert('Configuración importada correctamente.');
  }catch(err){alert('No pude importar la configuración: '+err.message)}
}
function exportTestTemplate(){
  const e=currentEv(); if(!e)return;
  if(!window.XLSX){alert('No se pudo cargar el generador de Excel.');return}
  const wb=XLSX.utils.book_new();
  e.forms.forEach(f=>{const rows=e.formConfigs[f].items.map((q,i)=>({Pregunta:i+1,Alternativas:(q.options||defaultOptionsFor(e)).join(','),Clave:q.key,Puntaje:q.points,Habilidad:q.skill||'',Contenido:q.content||''})); const ws=XLSX.utils.json_to_sheet(rows); XLSX.utils.book_append_sheet(wb,ws,f.slice(0,31)||'Forma')});
  XLSX.writeFile(wb,`${(e.name||'evaluacion').replace(/[^a-z0-9áéíóúñ_-]+/gi,'_')}_configuracion.xlsx`);
}

function syncCurrentQuestionRowsFromDOM(){
  const e=currentEv(),items=currentItems(),body=$('#questionRows');
  if(!e||!body||!items.length)return;
  [...body.querySelectorAll('tr')].forEach((tr,i)=>{
    const q=items[i];if(!q)return;
    const pts=tr.querySelector('.pts'),key=tr.querySelector('.key'),skill=tr.querySelector('.skill'),content=tr.querySelector('.content');
    if(pts)q.points=Math.max(0,Number(pts.value)||0);
    if(key&&q.options?.includes(key.value))q.key=key.value;
    if(skill)q.skill=skill.value;
    if(content)q.content=content.value;
  });
}

function updateEditor(){const e=currentEv();if(!e)return;syncCurrentQuestionRowsFromDOM();e.name=($('#editName')?.value||e.name||'').trim()||e.name;if($('#editorName'))$('#editorName').textContent=e.name;if($('#editorMeta'))$('#editorMeta').textContent=`${courseName(courseById(e.courseId))} · ${dateCL($('#editDate')?.value||e.date)} · ${e.forms.length} forma(s)`;e.unit=$('#editUnit').value;e.objective=$('#editObjective').value;e.type=$('#editType').value;e.date=$('#editDate').value;e.status=$('#editStatus').value;e.grading={threshold:Number($('#editThreshold').value)||60,minGrade:Number($('#editMinGrade').value)||1,passGrade:Number($('#editPassGrade').value)||4,maxGrade:Number($('#editMaxGrade').value)||7};const f=currentForm(),items=currentItems(),max=getMax(e,f),active=items.filter(q=>q.active).length;$('#sumQuestions').textContent=items.length;$('#sumActive').textContent=active;$('#sumVoid').textContent=items.length-active;$('#sumMaxScore').textContent=`${fmt(max)} pts`;const sum=$('#sumThreshold'),pass=$('#sumPassScore');if(e.type==='sumativa'){sum.textContent=`${fmt(e.grading.threshold)} %`;pass.textContent=`${fmt(max*e.grading.threshold/100,2)} pts`;$('#gradingBlock').classList.remove('hidden');$('#formativeBlock').classList.add('hidden');const s=$('#testScore').value;$('#testResult').value=s!==''?`Nota ${fmt(grade(s,e,f))} · ${fmt((Number(s)||0)/(max||1)*100)} %`:'—'}else{sum.textContent='Formativa';pass.textContent='No aplica';$('#gradingBlock').classList.add('hidden');$('#formativeBlock').classList.remove('hidden')}const maxima=e.forms.map(x=>[x,getMax(e,x)]),distinct=[...new Set(maxima.map(x=>x[1].toFixed(4)))];$('#formWarning').classList.toggle('hidden',distinct.length<2);if(distinct.length>1)$('#formWarning').innerHTML='Las formas tienen puntajes máximos distintos: '+maxima.map(x=>`<strong>${esc(x[0])}</strong> ${fmt(x[1])}`).join(' · ');persist()}
function renderScan(){
  const cur=$('#scanEvaluationSelect').value;
  $('#scanEvaluationSelect').innerHTML='<option value="">Selecciona evaluación</option>'+state.evaluations.map(e=>`<option value="${e.id}">${esc(e.name)} — ${esc(courseName(courseById(e.courseId)))}</option>`).join('');
  if(cur && state.evaluations.some(e=>e.id===cur)) $('#scanEvaluationSelect').value=cur;
  renderScanForms();
  $('#queueList').innerHTML=state.queue.length?state.queue.map((f,i)=>`<div class="queue-row"><div><strong>${esc(f.name)}</strong><div class="meta">${(f.size/1024/1024).toFixed(2)} MB · ${esc(f.type||'archivo')}</div></div><span class="status ${String(f.status||'').startsWith('Error')?'danger':''}">${esc(f.status||'En cola')}</span></div>`).join(''):'';
  const pages=state.scanPages||[];
  $('#batchSummary').innerHTML=`
    <div><span>Archivos</span><strong>${state.queue.length}</strong></div>
    <div><span>Páginas preparadas</span><strong>${pages.length}</strong></div>
    <div><span>Imágenes</span><strong>${pages.filter(p=>p.kind==='image').length}</strong></div>
    <div><span>PDF</span><strong>${pages.filter(p=>p.kind==='pdf').length}</strong></div>
    <div><span>Cámara</span><strong>${pages.filter(p=>p.kind==='camera').length}</strong></div>`;
  $('#analyzeOMR').disabled=!pages.length;
  $('#pageGrid').innerHTML=pages.length?pages.map((p,i)=>`<div class="page-card">
    <div class="thumb" id="thumb-${i}">${p.thumb?`<img src="${p.thumb}" alt="">`:'<span class="muted">Vista previa</span>'}</div>
    <div class="body"><strong>${esc(p.label)}</strong><div class="meta">${p.width&&p.height?`${p.width} × ${p.height}px`:'Página preparada'}</div>
    <div class="flags"><span class="flag ok">Lista</span><span class="flag">${esc(p.form||'Forma sin confirmar')}</span>${p.omr?`<span class="flag ${p.omr.ok?'read':'fail'}">${p.omr.ok?'OMR leído':'OMR con problema'}</span>`:''}${p.finalized?'<span class="flag saved-badge">Guardado</span>':(p.draftAnalyzed?'<span class="flag draft-badge">Borrador</span>':'')}${state.review.filter(r=>r.file===p.label).length?`<span class="flag warn">⚠ Revisar (${state.review.filter(r=>r.file===p.label).length})</span>`:(p.omr?.ok&&!p.omr?.studentMatch?.exact?'<span class="flag warn">⚠ Identificación pendiente</span>':'')}</div>
    ${p.omr?renderOMRCard(p.omr):''}
    </div>
  </div>`).join(''):'';
  const labels=new Set(pages.map(p=>p.label));
  const pending=state.review.filter(r=>labels.has(r.file));
  const analyzed=pages.filter(p=>p.omr);
  const unsaved=pages.filter(p=>p.omr?.ok&&!p.finalized);
  const hasWork=state.queue.length>0||pages.length>0;
  const hasAnalyzed=analyzed.length>0;
  $('#scanWorkActions')?.classList.toggle('hidden',!hasWork);
  $('#batchSummary')?.classList.toggle('hidden',!hasWork);
  $('#scanFinalize')?.classList.toggle('hidden',!hasAnalyzed);
  if($('#clearQueue'))$('#clearQueue').classList.toggle('hidden',!hasWork);
  if($('#prepareQueue'))$('#prepareQueue').classList.toggle('hidden',!state.queue.length);
  if($('#analyzeOMR'))$('#analyzeOMR').classList.toggle('hidden',!pages.length);
  if($('#reviewScanIssues')){
    $('#reviewScanIssues').classList.toggle('hidden',!pending.length);
    $('#reviewScanIssues').disabled=!pending.length;
  }
  if($('#saveScanChanges'))$('#saveScanChanges').disabled=!unsaved.length;
  if($('#scanFinalizeStatus')){
    $('#scanFinalizeStatus').textContent=hasAnalyzed
      ? `${analyzed.length} hoja(s) analizada(s) · ${pending.length} anomalía(s) pendiente(s) · ${pages.filter(p=>p.finalized).length} guardada(s)`
      : '';
  }
  if(!hasAnalyzed)$('#scanReviewPanel')?.classList.add('hidden');
  renderReview();
}

function renderOMRCard(o){
  if(!o)return '';
  if(!o.ok)return `<div class="omr-result"><div class="omr-line"><strong>Problema</strong><span>${esc(o.error||'No se pudo leer')}</span></div></div>`;
  const ans=(o.answers||[]).map((a,i)=>`${i+1}:${a.answer||'—'}${a.status==='ambiguous'?'?':''}`).join('  ');
  return `<div class="omr-result">
    <div class="omr-line"><strong>RUN leído</strong><span>${esc(o.run||'No concluyente')}</span></div>
    ${o.studentMatch?`<div class="omr-line"><strong>Estudiante</strong><span>${esc(o.studentMatch.name)}${o.studentMatch.exact?' ✓':' · revisar'}</span></div>`:''}
    <div class="omr-line"><strong>Respondidas</strong><span>${(o.answers||[]).filter(a=>a.answer).length}/${o.answers?.length||0}</span></div>
    <div class="omr-line"><strong>En blanco</strong><span>${(o.answers||[]).filter(a=>a.status==='blank').length}</span></div>
    ${o.score?`<div class="omr-line"><strong>Puntaje</strong><span>${o.score.earned.toFixed(1)} / ${o.score.max.toFixed(1)}</span></div>`:''}
    <div class="omr-answers">${esc(ans)}</div>
  </div>`;
}

function renderScanForms(){
  const eid=$('#scanEvaluationSelect').value;
  const sel=$('#scanFormSelect');
  if(!sel)return;
  const e=state.evaluations.find(x=>x.id===eid);
  if(!e){sel.innerHTML='<option value="">Seleccionar evaluación primero</option>';return}
  const forms=(e.forms&&e.forms.length?e.forms:Object.keys(e.formConfigs||{}));
  const old=sel.value;
  sel.innerHTML='<option value="">Auto / sin confirmar</option>'+forms.map(f=>`<option value="${esc(f)}">${esc(f)}</option>`).join('');
  if(forms.includes(old))sel.value=old;
}

function renderReview(){
  const box=$('#reviewList');if(!box)return;
  const labels=new Set((state.scanPages||[]).map(p=>p.label));
  const current=state.review.filter(r=>labels.has(r.file));
  if(!current.length){box.innerHTML='<div class="empty">No hay anomalías pendientes en este lote.</div>';return}
  box.innerHTML=current.map(r=>{
    const page=(state.scanPages||[]).find(p=>p.label===r.file);

    if(r.type==='Revisar RUN' && page?.omr){
      const courseId=page.omr.courseId;
      const students=state.students.filter(s=>s.courseId===courseId).slice()
        .sort((a,b)=>`${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`,'es'));
      const suggested=page.omr.studentMatch?.studentId||'';
      const raw=page.omr.rawRun||page.omr.run||'';
      const suggestedText=page.omr.studentMatch
        ? `${page.omr.studentMatch.name}${page.omr.studentMatch.exact?' · coincidencia exacta':' · sugerencia'}`
        : 'Sin coincidencia segura';
      return `<div class="review-card">
        <div class="review-grid">
          <div class="review-crop">
            ${page.omr.runCrop?`<img src="${page.omr.runCrop}" alt="Zona RUN">`:'<div class="empty">Sin recorte disponible</div>'}
            <div class="review-note">Recorte de la zona que analizó el lector.</div>
          </div>
          <div class="review-fields">
            <div>
              <strong>Revisar identificación</strong>
              <div class="meta">${esc(r.file||'')}</div>
              <p class="meta">${esc(r.detail||'')}</p>
            </div>
            <div class="review-readout">
              <div><span>Lectura del algoritmo</span><strong>${esc(raw||'Sin lectura')}</strong></div>
              <div><span>Coincidencia sugerida</span><strong>${esc(suggestedText)}</strong></div>
            </div>
            <label>Estudiante de la nómina
              <select id="review-student-${r.id}">
                <option value="">— Seleccionar manualmente —</option>
                ${students.map(s=>`<option value="${s.id}" ${s.id===suggested?'selected':''}>${esc(`${s.lastName||''} ${s.firstName||''}`.trim())} · ${esc(s.run||'Sin RUN')}</option>`).join('')}
              </select>
            </label>
            <label>RUN manual
              <input id="review-run-${r.id}" value="${esc(page.omr.studentMatch?.run||'')}" placeholder="Ej. 23.366.610-6 o 233666106">
            </label>
            <div class="actions">
              <button class="primary small" onclick="confirmRunReview('${r.id}')">Confirmar identificación</button>
              <button class="secondary small" onclick="clearRunReviewFields('${r.id}')">Limpiar</button>
            </div>
            <div class="review-note">Puedes seleccionar un estudiante aunque haya dejado el RUN vacío. Si escribes un RUN, la app intentará asociarlo con la nómina, pero no lo hará silenciosamente.</div>
            <details class="review-fullsheet"><summary>Ver hoja completa para comparar</summary>${page.thumb?`<img src="${page.thumb}" alt="Hoja completa">`:''}</details>
          </div>
        </div>
      </div>`;
    }

    if(r.type==='Revisar respuestas' && page?.omr){
      const qs=(page.omr.answers||[]).filter(a=>a.status==='ambiguous');
      const pending=pendingAnswerReviews[r.id]||{};
      return `<div class="review-card">
        <strong>Revisar respuestas</strong>
        <div class="meta">${esc(r.file||'')}</div>
        <div class="answer-review-list">
          ${qs.map(a=>{
            const selected=Object.prototype.hasOwnProperty.call(pending,a.n)?pending[a.n]:a.answer;
            const ev=state.evaluations.find(e=>e.id===page.omr.evaluationId);
            const form=page.omr.form||ev?.forms?.[0];
            const q=ev?.formConfigs?.[form]?.items?.[a.n-1];
            const labels=a.metrics?.labels||['A','B','C','D'].slice(0,a.scores?.length||4);
            const scoreText=labels.map((l,i)=>`${l}: ${Math.round((a.scores?.[i]||0)*100)}%`).join(' · ');
            return `<div class="answer-review-row">
              <div>${a.crop?`<img src="${a.crop}" alt="Zona alrededor de pregunta ${a.n}"><div class="review-context-note">Zona amplia alrededor del punto que analizó el lector. Úsala para verificar si existe desplazamiento de filas.</div>`:`<div class="empty">P${a.n}</div>`}</div>
              <div>
                <strong>Pregunta ${a.n}</strong>
                <div class="read-metrics">
                  <div class="read-metric"><span>Lectura</span><strong>${esc(a.answer||'Blanco')}</strong></div>
                  <div class="read-metric"><span>Clave correcta</span><strong>${esc(q?.key||'—')}</strong></div>
                  <div class="read-metric"><span>Puntaje</span><strong>${q?.points??'—'}</strong></div>
                  <div class="read-metric"><span>Estado</span><strong>Marca ambigua</strong></div>
                </div>
                ${q?.skill||q?.content?`<div class="meta">${q?.skill?`Habilidad: ${esc(q.skill)}`:''}${q?.skill&&q?.content?' · ':''}${q?.content?`Contenido: ${esc(q.content)}`:''}</div>`:''}
                <div class="meta">Intensidad: ${esc(scoreText)}</div>
                <div class="meta">Selección para guardar: <strong>${esc(selected||'Blanco')}</strong></div>
              </div>
              <div class="choice-buttons">
                ${['A','B','C','D'].map(l=>`<button class="${selected===l?'primary pending':'secondary'} small" onclick="selectPendingAnswer('${r.id}',${a.n},'${l}')">${l}</button>`).join('')}
                <button class="${selected===''?'primary pending':'secondary'} small" onclick="selectPendingAnswer('${r.id}',${a.n},'')">Blanco</button>
              </div>
            </div>`;
          }).join('')}
        </div>
        <details class="review-fullsheet"><summary>Ver hoja completa para comparar</summary>${page.thumb?`<img src="${page.thumb}" alt="Hoja completa">`:''}</details>
        <div class="review-savebar">
          <span class="status">${Object.keys(pending).length?'Hay cambios pendientes de guardar.':'Selecciona la respuesta correcta y luego guarda.'}</span>
          <button class="secondary small" onclick="cancelPendingAnswers('${r.id}')">Deshacer cambios</button>
          <button class="primary small" onclick="savePendingAnswers('${r.id}')">Guardar revisión</button>
        </div>
      </div>`;
    }

    return `<div class="list-item"><div><strong>${esc(r.type)}</strong><div class="meta">${esc(r.file||'')}</div><p class="meta">${esc(r.detail||'')}</p></div><button class="secondary small" onclick="resolveReview('${r.id}')">Marcar resuelto</button></div>`;
  }).join('');
}
function clearRunReviewFields(id){
  const s=$(`#review-student-${id}`),r=$(`#review-run-${id}`); if(s)s.value=''; if(r)r.value='';
}
function normalizeRunText(v){
  return String(v||'').toUpperCase().trim().replace(/\./g,'').replace(/\s/g,'').replace(/-/g,'');
}
function findStudentByManualRun(courseId,typed){
  const n=normalizeRunText(typed);
  if(!n)return null;
  return state.students.find(s=>s.courseId===courseId && normalizeRunText(s.run)===n) || null;
}
function confirmRunReview(id){
  const r=state.review.find(x=>x.id===id); if(!r)return;
  const page=(state.scanPages||[]).find(p=>p.label===r.file); if(!page?.omr)return alert('La hoja ya no está disponible en este lote.');
  const selectedId=$(`#review-student-${id}`)?.value||'';
  const typed=$(`#review-run-${id}`)?.value||'';
  let student=selectedId?state.students.find(s=>s.id===selectedId):null;
  if(!student && typed) student=findStudentByManualRun(page.omr.courseId,typed);

  if(student){
    page.omr.run=runForTemplate(student.run);
    page.omr.studentMatch={exact:true,distance:0,studentId:student.id,run:student.run,
      name:`${student.firstName||''} ${student.lastName||''}`.trim()||student.run,manual:true};
    page.omr.runIssues=[];
  }else if(typed){
    page.omr.run=runForTemplate(typed);
    page.omr.studentMatch={exact:false,distance:null,studentId:null,run:typed,name:'RUN ingresado manualmente',manual:true};
    page.omr.runIssues=[];
  }else{
    return alert('Selecciona un estudiante o ingresa un RUN manual.');
  }

  state.review=state.review.filter(x=>x.id!==id);
  updateStoredResultFromPage(page);
  persist();renderReview();renderScan();renderStats();if($('#results')?.classList.contains('active'))renderResults();
}
function selectPendingAnswer(reviewId,n,answer){
  pendingAnswerReviews[reviewId]=pendingAnswerReviews[reviewId]||{};
  pendingAnswerReviews[reviewId][n]=answer;
  renderReview();
}
function cancelPendingAnswers(reviewId){
  delete pendingAnswerReviews[reviewId];
  renderReview();
}
function savePendingAnswers(reviewId){
  const r=state.review.find(x=>x.id===reviewId); if(!r)return;
  const page=(state.scanPages||[]).find(p=>p.label===r.file); if(!page?.omr)return;
  const pending=pendingAnswerReviews[reviewId]||{};
  const ambiguous=page.omr.answers.filter(x=>x.status==='ambiguous');
  if(!ambiguous.length)return;
  if(!Object.keys(pending).length)return alert('No has seleccionado ningún cambio.');
  const missing=ambiguous.filter(a=>!Object.prototype.hasOwnProperty.call(pending,a.n));
  if(missing.length && !confirm(`Hay ${missing.length} pregunta(s) ambigua(s) sin modificar. ¿Deseas guardar solo los cambios seleccionados y mantener las demás pendientes?`))return;
  if(!confirm('¿Estás seguro de guardar estas correcciones?'))return;

  ambiguous.forEach(a=>{
    if(Object.prototype.hasOwnProperty.call(pending,a.n)){
      a.answer=pending[a.n];
      a.status='ok';
      a.reviewed=true;
    }
  });
  recomputePageScore(page);
  const remaining=page.omr.answers.filter(x=>x.status==='ambiguous');
  if(!remaining.length)state.review=state.review.filter(x=>x.id!==reviewId);
  else r.detail=remaining.map(x=>`P${x.n}: marca ambigua`).join(' · ');
  delete pendingAnswerReviews[reviewId];
  logActivity('answer_reviewed',`${page.label} · ${Object.keys(pending).length} respuesta(s) corregida(s)`,{evaluationId:page.omr?.evaluationId||null,resultKey:resultKeyForPage(page,page.omr)});
  updateStoredResultFromPage(page);
  persist();renderReview();renderScan();renderStats();
  if($('#results')?.classList.contains('active'))renderResults();
}
function recomputePageScore(page){
  const ev=state.evaluations.find(e=>e.id===page.omr?.evaluationId); if(!ev)return;
  const cfg=ev.formConfigs?.[page.omr.form]||ev.formConfigs?.[ev.forms?.[0]]; if(!cfg?.items)return;
  let earned=0,max=0;
  cfg.items.forEach((q,i)=>{if(q.active===false)return;const pts=Number(q.points)||0;max+=pts;
    if(page.omr.answers[i]?.answer && String(q.key||'').toUpperCase()===page.omr.answers[i].answer)earned+=pts;});
  page.omr.score={earned,max};
}
function resolveReview(id){state.review=state.review.filter(r=>r.id!==id);persist();renderReview();renderStats()}


function dataIntegrityReport(){
  const courseIds=new Set(state.courses.map(x=>x.id));
  const studentIds=new Set(state.students.map(x=>x.id));
  const evalIds=new Set(state.evaluations.map(x=>x.id));

  const orphanStudents=state.students.filter(s=>!courseIds.has(s.courseId));
  const orphanEvaluations=state.evaluations.filter(e=>!courseIds.has(e.courseId));
  const orphanResults=state.results.filter(r=>!evalIds.has(r.evaluationId));
  const badStudentLinks=state.results.filter(r=>r.omr?.studentMatch?.studentId && !studentIds.has(r.omr.studentMatch.studentId));

  const keys=new Map(),duplicates=[];
  state.results.forEach(r=>{
    const k=r.key||r.id;
    if(!k)return;
    if(keys.has(k))duplicates.push(k);else keys.set(k,true);
  });

  const malformedForms=[];
  state.evaluations.forEach(e=>{
    (e.forms||[]).forEach(f=>{
      if(!e.formConfigs?.[f]?.items?.length)malformedForms.push(`${e.name} / ${f}`);
    });
  });

  const issues=orphanStudents.length+orphanEvaluations.length+orphanResults.length+badStudentLinks.length+duplicates.length+malformedForms.length;
  return {orphanStudents,orphanEvaluations,orphanResults,badStudentLinks,duplicates,malformedForms,issues};
}
function renderDataIntegrity(){
  const box=$('#dataIntegritySummary');if(!box)return;
  const r=dataIntegrityReport();
  if($('#schemaVersionBadge'))$('#schemaVersionBadge').textContent=`Esquema ${APP_SCHEMA_VERSION}`;
  box.innerHTML=`<div class="integrity-grid">
    <div><span>Cursos</span><strong>${state.courses.length}</strong></div>
    <div><span>Personas</span><strong>${state.persons.length}</strong></div><div><span>Matrículas</span><strong>${state.enrollments.length}</strong></div><div><span>Registros de curso</span><strong>${state.students.length}</strong></div>
    <div><span>Evaluaciones</span><strong>${state.evaluations.length}</strong></div>
    <div><span>Resultados</span><strong>${state.results.length}</strong></div><div><span>Actividad</span><strong>${state.activity.length}</strong></div>
  </div>
  <div class="integrity-list">
    <div class="integrity-item ${r.issues?'warn':'ok'}"><span>Estado general</span><strong>${r.issues?`${r.issues} incidencia(s)`:'Sin incidencias detectadas'}</strong></div>
    ${r.orphanStudents.length?`<div class="integrity-item warn"><span>Estudiantes sin curso válido</span><strong>${r.orphanStudents.length}</strong></div>`:''}
    ${r.orphanEvaluations.length?`<div class="integrity-item warn"><span>Evaluaciones sin curso válido</span><strong>${r.orphanEvaluations.length}</strong></div>`:''}
    ${r.orphanResults.length?`<div class="integrity-item warn"><span>Resultados sin evaluación</span><strong>${r.orphanResults.length}</strong></div>`:''}
    ${r.badStudentLinks.length?`<div class="integrity-item warn"><span>Resultados con estudiante inexistente</span><strong>${r.badStudentLinks.length}</strong></div>`:''}
    ${r.duplicates.length?`<div class="integrity-item warn"><span>Resultados duplicados por clave</span><strong>${r.duplicates.length}</strong></div>`:''}
    ${r.malformedForms.length?`<div class="integrity-item warn"><span>Formas sin preguntas configuradas</span><strong>${r.malformedForms.length}</strong></div>`:''}
    ${r.orphanEnrollments?.length?`<div class="integrity-item warn"><span>Matrículas con vínculos inválidos</span><strong>${r.orphanEnrollments.length}</strong></div>`:''}
    ${r.studentsWithoutPerson?.length?`<div class="integrity-item warn"><span>Registros sin identidad longitudinal</span><strong>${r.studentsWithoutPerson.length}</strong></div>`:''}
  </div>
  <div class="meta" style="margin-top:8px">Último guardado: ${state.meta?.updatedAt?new Date(state.meta.updatedAt).toLocaleString('es-CL'):'—'} · Evidencias visuales: <span id="integrityEvidenceCount">calculando…</span></div>`;
  evidenceKeys().then(keys=>{const el=$('#integrityEvidenceCount');if(el)el.textContent=keys.length});
}


const AppArchitecture={
  version:'0.37',
  modules:{
    data:{name:'Datos',description:'Persistencia, identidad longitudinal opcional e integridad.',get snapshot(){return databaseSnapshot},get persist(){return persist},get audit(){return dataIntegrityReport}},
    evidence:{name:'Evidencias',description:'Imágenes corregidas asociadas a resultados.',get put(){return evidencePut},get get(){return evidenceGet},get remove(){return evidenceDelete},get keys(){return evidenceKeys}},
    omr:{name:'Motor OMR',description:'Captura, lectura geométrica, RUN y respuestas en borrador.',get analyze(){return analyzeOMRPage}},
    review:{name:'Revisión integrada',description:'Resolución manual de RUN y respuestas dentro del lote antes de guardar.',get render(){return renderReview},get identify(){return saveResultIdentity}},
    results:{name:'Resultados',description:'Cálculo, vistas e historial de desempeño.',get rows(){return resultRowsForEvaluation},get render(){return renderResults}},
    backup:{name:'Respaldos',description:'Exportación ligera/completa y restauración.',get light(){return exportBackup},get full(){return exportFullBackup},get restore(){return importBackupFile}}
  }
};
function architectureCheck(){
  const checks=[],add=(name,ok,detail)=>checks.push({name,ok:!!ok,detail});
  add('Base unificada',typeof databaseSnapshot==='function'&&typeof persist==='function','snapshot + persist');
  add('Evidencias',typeof evidencePut==='function'&&typeof evidenceGet==='function'&&typeof evidenceKeys==='function','IndexedDB');
  add('Motor OMR',typeof analyzeOMRPage==='function'&&typeof computeHomography==='function','análisis + homografía');
  add('Revisión',typeof renderReview==='function'&&typeof saveResultIdentity==='function','RUN + respuestas');
  add('Resultados',typeof resultRowsForEvaluation==='function'&&typeof renderResults==='function','cálculo + vistas');
  add('Respaldos',typeof exportBackup==='function'&&typeof exportFullBackup==='function'&&typeof importBackupFile==='function','ligero + completo');
  add('Estado persistente',['courses','students','persons','enrollments','evaluations','results','activity'].every(k=>Array.isArray(state[k])),'colecciones principales');
  return checks;
}
function renderArchitectureStatus(runCheck=false){
  const box=$('#architectureSummary');if(!box)return;
  const mods=Object.values(AppArchitecture.modules),checks=architectureCheck();
  box.innerHTML=`<div class="module-grid">${mods.map(m=>`<div class="module-card">
    <div class="head"><strong>${esc(m.name)}</strong><span class="module-status">Separado</span></div>
    <p>${esc(m.description)}</p>
  </div>`).join('')}</div>
  ${runCheck?`<div class="tech-check"><strong>Resultado del autodiagnóstico</strong>
    <div style="margin-top:7px">${checks.map(c=>`<div class="${c.ok?'ok':'warn'}">${c.ok?'✓':'⚠'} ${esc(c.name)} · ${esc(c.detail)}</div>`).join('')}</div>
  </div>`:''}`;
}

function renderSettings(){const wanted=Number($('#settingsYear')?.value)||state.years.slice().sort((a,b)=>b.year-a.year)[0]?.year||currentYear;fillYearSelect($('#settingsYear'),wanted);loadSelectedSchoolYear();$('#settingThreshold').value=state.settings.threshold;$('#settingMinGrade').value=state.settings.minGrade;$('#settingPassGrade').value=state.settings.passGrade;$('#settingMaxGrade').value=state.settings.maxGrade;renderDataIntegrity();renderArchitectureStatus(false)}
$$('.nav button').forEach(b=>b.onclick=()=>showView(b.dataset.view));$$('[data-goto]').forEach(b=>b.onclick=()=>showView(b.dataset.goto));$$('[data-close]').forEach(b=>b.onclick=()=>closeModal(b.dataset.close));
$('#studentAddForm').onsubmit=e=>{e.preventDefault();addManualStudent()};$('#manualStudentRun').oninput=updateManualStudentHistoryPreview;$('#previousStudentSearch').oninput=renderPreviousStudentList;
$('#topNewEvaluation').onclick=openNewEvaluation;$('#newEvaluation').onclick=openNewEvaluation;$('#calendarNewEvaluation').onclick=openNewEvaluation;$('#newCourse').onclick=()=>{const y=Number($('#courseYearFilter')?.value)||currentYear;fillYearSelect($('#courseYear'),y);openModal('courseModal')};
$('#courseForm').onsubmit=e=>{
  e.preventDefault();
  const file=$('#courseStudentFile')?.files?.[0]||null;
  const course={id:uid(),year:Number($('#courseYear').value),level:$('#courseLevel').value.trim(),letter:$('#courseLetter').value.trim().toUpperCase(),subject:$('#courseSubject').value.trim()};
  state.courses.push(course);persist();closeModal('courseModal');e.target.reset();renderCourses();renderCalendar();
  if(file){importStudents(file,course.id)}else{openCourse(course.id)}
};
$('#evaluationForm').onsubmit=e=>{e.preventDefault();if(!$('#evCourse').value){alert('Selecciona un curso.');return}saveEvaluation()};
$('#courseYearFilter').onchange=renderCourses;$('#courseSearch').oninput=renderCourses;$('#calendarYear').onchange=renderCalendar;$('#calendarCourse').onchange=renderCalendar;$('#evaluationSearch').oninput=renderEvaluations;$('#evaluationTypeFilter').onchange=renderEvaluations;if($('#showArchivedEvaluations'))$('#showArchivedEvaluations').onchange=renderEvaluations;
$('#backEvaluations').onclick=()=>{closeEditor();renderEvaluations()};$('#saveEditor').onclick=()=>{const e=currentEv();updateEditor();if(e&&scoringUnlocked.has(e.id)&&evaluationHasResults(e))logActivity('scoring_changed',e.name,{evaluationId:e.id});persist();renderEvaluations();renderCalendar();alert('Cambios guardados.')};$('#recalcScore').onclick=()=>{syncCurrentQuestionRowsFromDOM();const ev=currentEv();if(ev)recalcStoredResultsForEvaluation(ev.id);updateEditor();alert('Puntaje recalculado.')};['editName','editUnit','editObjective','editType','editDate','editStatus','editThreshold','editMinGrade','editPassGrade','editMaxGrade','testScore'].forEach(id=>$('#'+id).addEventListener('input',updateEditor));$('#editType').addEventListener('change',updateEditor);$('#editStatus').addEventListener('change',updateEditor);

$('#addForm').onclick=addForm;
$('#newFormName').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();addForm()}});
$('#deleteCurrentForm').onclick=deleteCurrentForm;
$('#questionRows').addEventListener('input',e=>{
  if(e.target.matches('.pts,.key,.skill,.content')){
    syncCurrentQuestionRowsFromDOM();
    const ev=currentEv();if(ev)recalcStoredResultsForEvaluation(ev.id);
    updateEditor();
  }
});
$('#questionRows').addEventListener('change',e=>{
  if(e.target.matches('.pts,.key,.skill,.content')){
    syncCurrentQuestionRowsFromDOM();
    const ev=currentEv();if(ev)recalcStoredResultsForEvaluation(ev.id);
    updateEditor();
  }
});

$('#questionRows').addEventListener('click',e=>{
  const key=e.target.closest('button[data-key-option]');
  if(key){e.preventDefault();e.stopPropagation();setQuestionKey(Number(key.dataset.question),key.dataset.keyOption);return}
  const rem=e.target.closest('button[data-option-remove]');
  if(rem){e.preventDefault();e.stopPropagation();removeQuestionOption(Number(rem.dataset.question),rem.dataset.optionRemove);return}
  const restore=e.target.closest('button[data-option-restore]');
  if(restore){e.preventDefault();e.stopPropagation();restoreQuestionOption(Number(restore.dataset.question),restore.dataset.optionRestore);return}
  const btn=e.target.closest('button[data-question-index]');
  if(!btn)return;e.preventDefault();e.stopPropagation();toggleQuestionActive(Number(btn.dataset.questionIndex))
});
$('#applyFormQuestionCount').onclick=setCurrentFormQuestionCount;$('#applyFormChoiceCount').onclick=setCurrentFormChoiceCount;
$('#repairQuestions').onclick=()=>{const e=currentEv();if(!e)return;const n=Math.max(1,Number(e.questions)||1);if(!confirm(`Reconstruir las ${n} preguntas de la forma ${currentForm()}? Se conservarán las ya existentes y solo se completarán las que falten.`))return;ensureEvaluationQuestions(e);renderQuestionRows();updateEditor();persist()};
$('#allOnePoint').onclick=()=>{currentItems().forEach(q=>q.points=1);renderQuestionRows();updateEditor();persist()};$('#copyForm').onclick=()=>{const e=currentEv(),src=$('#copyFromForm').value;if(!e||!src)return;e.formConfigs[currentForm()].items=cloneItems(e.formConfigs[src].items);renderQuestionRows();updateEditor();persist()};
$('#testConfigImport').onchange=e=>{importTestConfig(e.target.files[0]);e.target.value=''};$('#exportTestTemplate').onclick=exportTestTemplate;

$('#openCamera').onclick=openCameraMode;
$('#cameraCaptureReady').onclick=()=>captureCameraFrame();
$('#cameraClose').onclick=closeCameraMode;
$('#cameraAnalyzeClose').onclick=closeCameraAndAnalyze;
$('#cameraCaptureFallback').onchange=e=>{const f=e.target.files?.[0];if(f)addFallbackCameraFile(f);e.target.value=''};

$('#scanFiles').onchange=e=>{
  [...e.target.files].forEach(f=>state.queue.push({name:f.name,size:f.size,type:f.type,status:'En cola',file:f}));
  state.scanPages=[];
  renderScan()
};
$('#scanEvaluationSelect').onchange=()=>{renderScanForms()};
$('#clearQueue').onclick=()=>{
  const labels=new Set((state.scanPages||[]).map(p=>p.label));
  const pending=state.review.filter(r=>labels.has(r.file));
  if(pending.length){
    alert(`Hay ${pending.length} incidencia(s) pendiente(s) de este lote. Resuélvelas en la pestaña Revisión antes de vaciarlo, para no perder los recortes visuales.`);
    return;
  }
  (state.scanPages||[]).forEach(p=>{if(p.thumb&&p.thumb.startsWith('blob:'))URL.revokeObjectURL(p.thumb)});
  state.queue=[];state.scanPages=[];renderScan();
  // Los resultados ya corregidos quedan guardados de forma permanente.
};
$('#prepareQueue').onclick=async()=>{
  if(!state.queue.length){
    if((state.scanPages||[]).some(p=>p.kind==='camera'))return alert('Las capturas de cámara ya están preparadas automáticamente. Puedes pulsar “Analizar OMR”.');
    return alert('No hay archivos para preparar.');
  }
  if(!$('#scanEvaluationSelect').value)return alert('Selecciona una evaluación.');
  const btn=$('#prepareQueue');btn.disabled=true;btn.textContent='Preparando…';
  $('#scanProgressWrap').classList.remove('hidden');
  state.scanPages=[];
  let done=0,total=state.queue.length;
  try{
    for(const item of state.queue){
      item.status='Preparando';
      item.error='';
      updateScanProgress(done,total,`Preparando ${item.name}`);
      try{
        if(item.type==='application/pdf'||item.name.toLowerCase().endsWith('.pdf')){
          await preparePdfItem(item);
          item.status='Preparado';
        }else if((item.type||'').startsWith('image/')||/\.(jpg|jpeg|png)$/i.test(item.name)){
          await prepareImageItem(item);
          item.status='Preparado';
        }else{
          item.status='Formato no compatible';
        }
      }catch(err){
        console.error('Error preparando', item.name, err);
        item.status='Error: '+(err && err.message ? err.message : 'no se pudo leer');
        item.error=String(err && err.message ? err.message : err);
      }
      done++;
      updateScanProgress(done,total,`${done} de ${total} archivos preparados`);
      renderScan();
    }
  }catch(err){
    console.error(err);alert('Ocurrió un problema al preparar el lote: '+err.message);
  }finally{
    btn.disabled=false;btn.textContent='Preparar archivos';
    setTimeout(()=>$('#scanProgressWrap').classList.add('hidden'),1200);
    renderScan();
  }
};

function currentBatchReviewIssues(){
  const labels=new Set((state.scanPages||[]).map(p=>p.label));
  return state.review.filter(r=>labels.has(r.file));
}
function openBatchReview(){
  const panel=$('#scanReviewPanel');if(!panel)return;
  panel.classList.remove('hidden');
  renderReview();
  panel.scrollIntoView({behavior:'smooth',block:'start'});
}
async function finalizeScanBatch(){
  const pages=(state.scanPages||[]).filter(p=>p.omr?.ok&&!p.finalized);
  if(!pages.length)return alert('No hay hojas analizadas pendientes de guardar.');
  const pending=currentBatchReviewIssues();
  const pendingLabels=new Set(pending.map(r=>r.file));
  const clean=pages.filter(p=>!pendingLabels.has(p.label));
  const unresolved=pages.filter(p=>pendingLabels.has(p.label));

  if(unresolved.length){
    const ok=confirm(`Hay datos sin revisar en ${unresolved.length} hoja(s).\n\nSi no se revisan, esas hojas no se traspasarán al curso y sus datos pendientes se perderán. Las ${clean.length} hoja(s) sin anomalías sí se guardarán.\n\n¿Continuar?`);
    if(!ok){openBatchReview();return}
  }
  if(!clean.length&&unresolved.length){
    if(!confirm('Todas las hojas tienen datos pendientes. Si continúas, no se guardará ningún resultado de este lote. ¿Continuar?'))return;
  }

  const btn=$('#saveScanChanges');if(btn){btn.disabled=true;btn.textContent='Guardando…'}
  let saved=0;
  try{
    for(const p of clean){
      await savePageResult(p);
      p.finalized=true;
      saved++;
    }
    if(unresolved.length){
      const omitLabels=new Set(unresolved.map(p=>p.label));
      state.review=state.review.filter(r=>!omitLabels.has(r.file));
      unresolved.forEach(p=>{p.omitted=true;p.draftAnalyzed=false});
      state.scanPages=state.scanPages.filter(p=>!omitLabels.has(p.label));
    }
    const eid=$('#scanEvaluationSelect')?.value;
    const ev=state.evaluations.find(e=>e.id===eid);
    if(ev&&saved)ev.status='escaneada';
    persist();renderReview();renderScan();renderStats();renderDashboard();renderCourses();
    alert(`${saved} hoja(s) traspasada(s) al curso${unresolved.length?` · ${unresolved.length} hoja(s) con datos sin revisar fueron omitidas`:''}.`);
  }finally{
    if(btn){btn.textContent='Guardar cambios';btn.disabled=false}
    renderScan();
  }
}
$('#reviewScanIssues').onclick=openBatchReview;
$('#saveScanChanges').onclick=finalizeScanBatch;

function updateScanProgress(done,total,text){
  const pct=total?Math.round(done/total*100):0;
  $('#scanProgressBar').style.width=pct+'%';$('#scanProgressText').textContent=text||'';
}
async function prepareImageItem(item){
  const url=URL.createObjectURL(item.file);
  const dims=await getImageDimensions(url);
  state.scanPages.push({kind:'image',sourceName:item.name,label:item.name,thumb:url,width:dims.width,height:dims.height,form:$('#scanFormSelect').value||''});
}
function getImageDimensions(url){return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve({width:im.naturalWidth,height:im.naturalHeight});im.onerror=reject;im.src=url})}
async function loadPdfJs(){
  if(window.pdfjsLib)return window.pdfjsLib;
  throw new Error('No se pudo cargar el componente PDF.js. Comprueba que el computador tenga conexión a internet y vuelve a abrir el archivo HTML.');
}
async function preparePdfItem(item){
  const pdfjs=await loadPdfJs();
  const data=new Uint8Array(await item.file.arrayBuffer());
  // Desactivamos el worker en este prototipo porque al abrir el HTML directamente
  // desde el computador algunos navegadores bloquean el worker remoto.
  const loadingTask=pdfjs.getDocument({data, disableWorker:true});
  const pdf=await loadingTask.promise;
  for(let p=1;p<=pdf.numPages;p++){
    const page=await pdf.getPage(p);
    const base=page.getViewport({scale:1});
    const scale=Math.min(2.2,1200/base.width);
    const viewport=page.getViewport({scale});
    const c=document.createElement('canvas');c.width=Math.round(viewport.width);c.height=Math.round(viewport.height);
    await page.render({canvasContext:c.getContext('2d'),viewport}).promise;
    const thumb=c.toDataURL('image/jpeg',0.78);
    state.scanPages.push({kind:'pdf',sourceName:item.name,label:`${item.name} · pág. ${p}`,thumb,width:c.width,height:c.height,page:p,form:$('#scanFormSelect').value||''});
  }
}


// ===== Cámara experimental v0.34 =====
let cameraStream=null;
let cameraProbeTimer=null;
let cameraReady=false;
let cameraSessionCaptures=0;
let cameraSessionLabels=[];

async function openCameraMode(){
  if(!$('#scanEvaluationSelect')?.value){
    alert('Selecciona primero la evaluación que vas a escanear.');
    return;
  }
  openModal('cameraModal');
  cameraSessionCaptures=0;cameraSessionLabels=[];
  $('#cameraCaptureCount').textContent='0';if($('#cameraAnalyzeClose'))$('#cameraAnalyzeClose').disabled=true;if($('#cameraLastCapture'))$('#cameraLastCapture').innerHTML='';
  setCameraStatus('Iniciando cámara…',0,'warn');
  try{
    if(!navigator.mediaDevices?.getUserMedia){
      throw new Error('Este navegador no ofrece acceso directo a la cámara.');
    }
    cameraStream=await navigator.mediaDevices.getUserMedia({
      video:{
        facingMode:{ideal:'environment'},
        width:{ideal:1920},
        height:{ideal:1080}
      },
      audio:false
    });
    const video=$('#cameraVideo');
    video.srcObject=cameraStream;
    await video.play();
    setCameraStatus('Buscando los cuatro marcadores…',0,'warn');
    startCameraProbe();
  }catch(err){
    console.warn('Cámara:',err);
    setCameraStatus('No se pudo abrir la cámara en vivo.',0,'bad');
    alert(`No se pudo abrir la cámara en vivo.\n\n${err.message||err}\n\nSi abriste el HTML con doble clic, prueba “Tomar foto con cámara”. La cámara en vivo necesita HTTPS o localhost.`);
  }
}
function setCameraStatus(text,count=0,kind='warn'){
  const box=$('#cameraLiveStatus');
  if(box){box.classList.remove('ready','warn','bad');box.classList.add(kind)}
  if($('#cameraStatusText'))$('#cameraStatusText').textContent=text;
  if($('#cameraMarkerCount'))$('#cameraMarkerCount').textContent=`${count}/4`;
  cameraReady=count===4;
  if($('#cameraCaptureReady'))$('#cameraCaptureReady').disabled=!cameraReady;
}
function startCameraProbe(){
  stopCameraProbe();
  cameraProbeTimer=setInterval(probeCameraFrame,650);
  probeCameraFrame();
}
function stopCameraProbe(){
  if(cameraProbeTimer){clearInterval(cameraProbeTimer);cameraProbeTimer=null}
}
function probeCameraFrame(){
  const video=$('#cameraVideo');
  if(!video||!video.videoWidth||!video.videoHeight)return;
  try{
    const c=$('#cameraProbeCanvas'),ctx=c.getContext('2d',{willReadFrequently:true});
    const maxW=520,scale=Math.min(1,maxW/video.videoWidth);
    c.width=Math.max(1,Math.round(video.videoWidth*scale));
    c.height=Math.max(1,Math.round(video.videoHeight*scale));
    ctx.drawImage(video,0,0,c.width,c.height);
    const im=ctx.getImageData(0,0,c.width,c.height);
    const det=detectOuterMarkersDetailed(im);
    const count=det.markers.filter(Boolean).length;
    if(count===4&&det.geometry.ok){
      setCameraStatus('Hoja detectada y geometría válida. Mantén la cámara estable.',4,'ready');
    }else if(count===4){
      setCameraStatus(det.geometry.reason||'Se ven cuatro cuadrados, pero la geometría no es confiable.',4,'warn');
      cameraReady=false;$('#cameraCaptureReady').disabled=true;
    }else if(count>=2){
      setCameraStatus('Casi lista: ajusta el encuadre para ver toda la hoja.',count,'warn');
    }else{
      setCameraStatus('Busca la hoja completa y sus cuatro cuadrados negros.',count,'bad');
    }
  }catch(err){
    console.warn('Detección en vivo:',err);
  }
}
function cameraTimestamp(){
  const d=new Date();
  return d.toLocaleTimeString('es-CL',{hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});
}
async function captureCameraFrame(){
  const video=$('#cameraVideo');
  if(!video||!video.videoWidth||!video.videoHeight)return alert('La cámara todavía no está lista.');
  if(!cameraReady)return;
  const c=$('#cameraCaptureCanvas'),ctx=c.getContext('2d');
  c.width=video.videoWidth;c.height=video.videoHeight;
  ctx.drawImage(video,0,0,c.width,c.height);
  const data=c.toDataURL('image/jpeg',0.9);
  const label=`Cámara ${cameraTimestamp()} · ${cameraSessionCaptures+1}`;
  state.scanPages.push({
    kind:'camera',sourceName:'Cámara en vivo',label,thumb:data,width:c.width,height:c.height,
    form:$('#scanFormSelect').value||'',capturedAt:new Date().toISOString(),cameraSession:true
  });
  cameraSessionLabels.push(label);
  cameraSessionCaptures++;
  $('#cameraCaptureCount').textContent=String(cameraSessionCaptures);
  if($('#cameraAnalyzeClose'))$('#cameraAnalyzeClose').disabled=false;
  const flash=$('#cameraFlash');if(flash){flash.classList.add('show');setTimeout(()=>flash.classList.remove('show'),150)}
  if(navigator.vibrate)try{navigator.vibrate(70)}catch(_){}
  const okBtn=$('#cameraCaptureReady');
  if(okBtn){
    const old=okBtn.textContent;okBtn.textContent=`✓ ${cameraSessionCaptures}`;
    okBtn.disabled=true;
    setTimeout(()=>{okBtn.textContent=old;okBtn.disabled=!cameraReady},500);
  }
  renderScan();
  setCameraStatus(`Captura ${cameraSessionCaptures} agregada`,cameraReady?4:0,cameraReady?'ready':'warn');
}
function stopCameraHardware(){
  stopCameraProbe();
  if(cameraStream){cameraStream.getTracks().forEach(t=>t.stop());cameraStream=null}
  const video=$('#cameraVideo');if(video)video.srcObject=null;
}
function discardCameraSessionCaptures(){
  const labels=new Set(cameraSessionLabels);
  state.scanPages=state.scanPages.filter(p=>!labels.has(p.label));
  state.review=state.review.filter(r=>!labels.has(r.file));
  cameraSessionLabels=[];cameraSessionCaptures=0;
  renderScan();
}
function closeCameraMode(){
  if(cameraSessionLabels.length){
    const ok=confirm(`Hay ${cameraSessionLabels.length} hoja(s) pendientes de analizar.\n\nSi cierras la cámara, estas capturas se perderán.\n\n¿Continuar?`);
    if(!ok)return;
    discardCameraSessionCaptures();
  }
  stopCameraHardware();
  closeModal('cameraModal');
}
async function closeCameraAndAnalyze(){
  if(!cameraSessionLabels.length)return;
  const count=cameraSessionLabels.length;
  if(!confirm(`Se analizarán ${count} captura(s) realizadas.\n\n¿Continuar?`))return;
  const labels=[...cameraSessionLabels];
  stopCameraHardware();
  closeModal('cameraModal');
  cameraSessionLabels=[];cameraSessionCaptures=0;
  const pages=state.scanPages.filter(p=>labels.includes(p.label));
  await analyzeOMRPages(pages);
}
async function addFallbackCameraFile(file){
  if(!file)return;
  if(!$('#scanEvaluationSelect')?.value){
    alert('Selecciona primero una evaluación.');
    return;
  }
  try{
    const url=URL.createObjectURL(file);
    const dims=await getImageDimensions(url);
    state.scanPages.push({
      kind:'camera',
      sourceName:file.name||'Cámara del dispositivo',
      label:`Cámara ${cameraTimestamp()}`,
      thumb:url,
      width:dims.width,
      height:dims.height,
      form:$('#scanFormSelect').value||'',
      capturedAt:new Date().toISOString()
    });
    renderScan();
  }catch(err){
    alert('No se pudo preparar la fotografía: '+err.message);
  }
}

// ===== OMR v0.8: lector específico para la plantilla actual =====
const OMR_TEMPLATE={
  width:1225,height:1582,
  markers:[
    {x:188.5,y:149.5},{x:1030.5,y:146.0},
    {x:193.5,y:1466.5},{x:1034.0,y:1465.0}
  ],
  leftX:[407,438,470,500],
  rightX:[733,765,796,827],
  topRows:Array.from({length:10},(_,i)=>612+i*32),
  bottomRows:Array.from({length:15},(_,i)=>944+i*32),
  runX:[702,737,771,805,839,873,907,941,975],
  runY:[265,295,325,355,385,415,445,475,505,535]
};

async function analyzeOMRPages(pages){
  if(!pages?.length)return alert('No hay hojas para analizar.');
  const eid=$('#scanEvaluationSelect').value;
  const ev=state.evaluations.find(e=>e.id===eid);
  if(!ev)return alert('Selecciona una evaluación.');
  const btn=$('#analyzeOMR');
  if(btn){btn.disabled=true;btn.textContent='Analizando…'}
  $('#scanProgressWrap').classList.remove('hidden');
  const total=pages.length;
  const labels=new Set(pages.map(p=>p.label));
  state.review=state.review.filter(r=>!(r.source==='omr'&&labels.has(r.file)));
  for(let i=0;i<total;i++){
    const p=pages[i];
    updateScanProgress(i,total,`Leyendo ${i+1} de ${total}: ${p.label}`);
    try{
      p.omr=await analyzeOMRPage(p,ev);
      if(p.omr.ok){p.draftAnalyzed=true;p.finalized=false;}
      if(!p.omr.ok){
        state.review.push({id:uid(),source:'omr',type:'Reescanear hoja',file:p.label,detail:p.omr.error||'No se pudo detectar la plantilla.'});
      }else{
        if(!p.omr.run || p.omr.runIssues?.length || !p.omr.studentMatch || !p.omr.studentMatch.exact){
          const sm=p.omr.studentMatch;
          const detail=[
            p.omr.rawRun?`Lectura: ${p.omr.rawRun}`:'',
            ...(p.omr.runIssues||[]),
            sm&&!sm.exact?`Posible estudiante: ${sm.name} (${sm.distance} dígito${sm.distance===1?'':'s'} de diferencia)`:'',
            !sm&&p.omr.run?'El RUN leído no coincide con estudiantes del curso':''
          ].filter(Boolean).join(' · ');
          state.review.push({id:uid(),source:'omr',type:'Revisar RUN',file:p.label,detail:detail||'RUN no concluyente'});
        }
        const bad=p.omr.answers.filter(a=>a.status==='ambiguous');
        if(bad.length){
          state.review.push({id:uid(),source:'omr',type:'Revisar respuestas',file:p.label,detail:bad.map(a=>`P${a.n}: marca ambigua`).join(' · ')});
        }
      }
    }catch(err){
      console.error(err);
      p.omr={ok:false,error:String(err?.message||err)};
      state.review.push({id:uid(),source:'omr',type:'Error OMR',file:p.label,detail:p.omr.error});
    }
    renderScan();
    updateScanProgress(i+1,total,`${i+1} de ${total} páginas analizadas`);
    await new Promise(r=>setTimeout(r,15));
  }
  persist();renderReview();renderStats();renderScan();
  if(btn){btn.disabled=false;btn.textContent='Analizar OMR'}
  setTimeout(()=>$('#scanProgressWrap').classList.add('hidden'),1000);
}
$('#analyzeOMR').onclick=async()=>{
  const pages=(state.scanPages||[]).filter(p=>!p.finalized);
  await analyzeOMRPages(pages);
};


function answerCanonicalPoint(n,letter){
  const centers=responseCenters(n),idx=['A','B','C','D'].indexOf(letter);
  if(idx<0||!centers[idx])return null;
  return centers[idx];
}
function answerSourcePoint(H,n,letter){
  const p=answerCanonicalPoint(n,letter);
  return p?applyH(H,p.x,p.y):null;
}
function drawPerspectiveBubble(ctx,H,n,letter,radius,scale,strokeStyle,lineWidth){
  const c=answerCanonicalPoint(n,letter);if(!c)return;
  ctx.beginPath();
  const steps=32;
  for(let i=0;i<=steps;i++){
    const a=(Math.PI*2*i)/steps;
    const p=applyH(H,c.x+Math.cos(a)*radius,c.y+Math.sin(a)*radius);
    const x=p.x*scale,y=p.y*scale;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
  }
  ctx.strokeStyle=strokeStyle;
  ctx.lineWidth=lineWidth;
  ctx.stroke();
}
function rowSourcePoint(H,n){
  const centers=responseCenters(n).filter(Boolean);
  if(!centers.length)return null;
  const x=Math.min(...centers.map(p=>p.x))-25,y=centers[0].y;
  return applyH(H,x,y);
}
async function canvasToJpegBlob(canvas,quality=.72){
  return await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
}
async function buildCorrectionEvidence(page){
  const ev=state.evaluations.find(e=>e.id===page.omr?.evaluationId);
  if(!ev||!page?.thumb||!page.omr?.ok)return null;
  const img=await loadImageFromUrl(page.thumb);
  const source=document.createElement('canvas');
  source.width=img.naturalWidth||img.width;source.height=img.naturalHeight||img.height;
  const sctx=source.getContext('2d');sctx.drawImage(img,0,0,source.width,source.height);

  const markers=page.omr.markers;
  if(!markers||markers.some(x=>!x))return null;
  const H=computeHomography(OMR_TEMPLATE.markers,markers);
  if(!H)return null;

  // Reduce very large photos before persisting.
  const maxW=1400,scale=Math.min(1,maxW/source.width);
  const out=document.createElement('canvas');
  out.width=Math.round(source.width*scale);out.height=Math.round(source.height*scale);
  const ctx=out.getContext('2d');
  ctx.drawImage(source,0,0,out.width,out.height);
  ctx.lineWidth=Math.max(2,4*scale);
  ctx.font=`${Math.max(11,18*scale)}px Arial`;
  ctx.textBaseline='middle';

  const form=page.omr.form||ev.forms?.[0],cfg=ev.formConfigs?.[form]||ev.formConfigs?.[ev.forms?.[0]];
  (page.omr.answers||[]).forEach((a,i)=>{
    const q=cfg?.items?.[i];if(!q||q.active===false)return;
    const ans=(a.answer||'').toUpperCase(),key=String(q.key||'').toUpperCase();
    if(ans){
      const correct=ans===key;
      // Se dibuja el contorno en coordenadas de la plantilla y luego se transforma
      // con la misma homografía de la hoja. Así la marca respeta inclinación,
      // escala y perspectiva en vez de superponer un círculo fijo en pantalla.
      drawPerspectiveBubble(ctx,H,i+1,ans,14,scale,correct?'#2d8a5d':'#c84d3f',Math.max(2,4*scale));
      if(!correct){
        drawPerspectiveBubble(ctx,H,i+1,key,10,scale,'#2d8a5d',Math.max(2,3*scale));
      }
    }else{
      const rp=rowSourcePoint(H,i+1);if(!rp)return;
      ctx.fillStyle='#d69a23';ctx.fillText(`P${i+1} blanco`,rp.x*scale,rp.y*scale);
    }
  });

  // Header strip with audit information.
  const h=Math.max(34,48*scale);
  ctx.fillStyle='rgba(255,255,255,.92)';ctx.fillRect(0,0,out.width,h);
  ctx.fillStyle='#1e2935';ctx.font=`bold ${Math.max(12,18*scale)}px Arial`;
  const student=page.omr.studentMatch?.name||page.omr.studentMatch?.run||'Sin identificar';
  ctx.fillText(`${ev.name} · ${student} · ${form||'Sin forma'}`,12*scale,h/2);

  return await canvasToJpegBlob(out,.72);
}
async function saveCorrectionEvidence(page,key){
  try{
    const blob=await buildCorrectionEvidence(page);
    if(blob)await evidencePut(key,blob);
  }catch(err){console.warn('No se pudo crear evidencia de corrección:',err)}
}

async function analyzeOMRPage(page,ev){
  const img=await loadImageFromUrl(page.thumb);
  const c=document.createElement('canvas');
  c.width=img.naturalWidth||img.width;c.height=img.naturalHeight||img.height;
  const ctx=c.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,c.width,c.height);
  const im=ctx.getImageData(0,0,c.width,c.height);
  const det=detectOuterMarkersDetailed(im);
  const markers=det.markers;
  if(markers.some(x=>!x))return {ok:false,error:'No se detectaron con seguridad los cuatro marcadores exteriores.'};
  if(!det.geometry.ok)return {ok:false,error:`Se detectaron cuatro candidatos, pero la geometría no es confiable: ${det.geometry.reason}`};
  const H=computeHomography(OMR_TEMPLATE.markers,markers);
  if(!H)return {ok:false,error:'No fue posible calcular la geometría de la hoja.'};

  const form=page.form||$('#scanFormSelect').value||ev.forms?.[0]||'';
  const cfg=ev.formConfigs?.[form]||ev.formConfigs?.[ev.forms?.[0]];
  const qCount=Math.min(cfg?.items?.length||Number(ev.questions)||50,50);
  const answers=[];
  for(let n=1;n<=qCount;n++){
    const centers=responseCenters(n);
    const q=cfg?.items?.[n-1];
    const activeOpts=(q?.options?.length?q.options:defaultOptionsFor(ev)).filter(x=>['A','B','C','D'].includes(x));
    const all=['A','B','C','D'];
    const pairs=activeOpts.map(letter=>({letter,pt:centers[all.indexOf(letter)]})).filter(x=>x.pt);
    const scores=pairs.map(x=>bubbleDarkness(im,H,x.pt.x,x.pt.y,7.5));
    const ar=classifyRow(n,scores,pairs.map(x=>x.letter));
    if(ar.status==='ambiguous'){
      const pts=centers.filter(Boolean);
      if(pts.length){
        const minx=Math.min(...pts.map(p=>p.x))-95,maxx=Math.max(...pts.map(p=>p.x))+42;
        // Contexto vertical amplio: si existe un pequeño desplazamiento geométrico
        // se muestran también las filas vecinas y el número impreso de la pregunta.
        const miny=Math.min(...pts.map(p=>p.y))-105,maxy=Math.max(...pts.map(p=>p.y))+105;
        ar.crop=cropCanonicalRegion(c,ctx,H,minx,miny,maxx,maxy);
      }
    }
    answers.push(ar);
  }
  const runResult=readRun(im,H);
  const runCrop=cropCanonicalRegion(c,ctx,H,665,235,1000,555);
  const studentMatch=matchRunToRoster(runResult.run,ev.courseId);
  // Si el OCR quedó a un solo dígito de un estudiante único, no corregimos silenciosamente:
  // mostramos la sugerencia y la enviamos a revisión.
  let score=null;
  if(cfg?.items){
    let earned=0,max=0;
    for(let i=0;i<Math.min(qCount,cfg.items.length);i++){
      const q=cfg.items[i]; if(q.active===false)continue;
      const pts=Number(q.points)||0;max+=pts;
      if(answers[i]?.answer && String(q.key||'').toUpperCase().split(/[^A-E]+/).includes(answers[i].answer))earned+=pts;
    }
    score={earned,max};
  }
  return {ok:true,markers,rawRun:runResult.raw,run:runResult.run,runCrop,runIssues:runResult.issues,studentMatch,answers,score,form,evaluationId:ev.id,courseId:ev.courseId};
}

function cropCanonicalRegion(sourceCanvas,sourceCtx,H,x0,y0,x1,y1){
  const corners=[applyH(H,x0,y0),applyH(H,x1,y0),applyH(H,x1,y1),applyH(H,x0,y1)];
  const minx=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.x))));
  const maxx=Math.min(sourceCanvas.width,Math.ceil(Math.max(...corners.map(p=>p.x))));
  const miny=Math.max(0,Math.floor(Math.min(...corners.map(p=>p.y))));
  const maxy=Math.min(sourceCanvas.height,Math.ceil(Math.max(...corners.map(p=>p.y))));
  if(maxx<=minx||maxy<=miny)return '';
  const out=document.createElement('canvas'),pad=6;
  out.width=maxx-minx+pad*2;out.height=maxy-miny+pad*2;
  const o=out.getContext('2d');o.fillStyle='#fff';o.fillRect(0,0,out.width,out.height);
  o.drawImage(sourceCanvas,minx,miny,maxx-minx,maxy-miny,pad,pad,maxx-minx,maxy-miny);
  return out.toDataURL('image/jpeg',0.88);
}

function responseCenters(n){
  if(n<=10)return OMR_TEMPLATE.leftX.map(x=>({x,y:OMR_TEMPLATE.topRows[n-1]}));
  if(n<=25)return OMR_TEMPLATE.leftX.map(x=>({x,y:OMR_TEMPLATE.bottomRows[n-11]}));
  if(n<=35)return OMR_TEMPLATE.rightX.map(x=>({x,y:OMR_TEMPLATE.topRows[n-26]}));
  return OMR_TEMPLATE.rightX.map(x=>({x,y:OMR_TEMPLATE.bottomRows[n-36]}));
}
function classifyRow(n,scores,labels=['A','B','C','D']){
  const ranked=scores.map((s,i)=>({s,i})).sort((a,b)=>b.s-a.s);
  const best=ranked[0],second=ranked[1];
  const baseline=(scores.reduce((a,b)=>a+b,0)-best.s)/Math.max(1,scores.length-1);
  const threshold=Math.max(.24,baseline+.10);
  const margin=best.s-(second?.s||0);
  const metrics={best:best.s,second:second?.s||0,margin,threshold,labels};
  if(best.s<threshold)return {n,answer:'',status:'blank',scores,metrics};
  if(second.s>.22 && margin<.10)return {n,answer:labels[best.i],status:'ambiguous',scores,metrics};
  return {n,answer:labels[best.i],status:'ok',scores,metrics};
}
function readRun(im,H){
  let digits='',issues=[];
  for(let col=0;col<OMR_TEMPLATE.runX.length;col++){
    const scores=OMR_TEMPLATE.runY.map(y=>bubbleDarkness(im,H,OMR_TEMPLATE.runX[col],y,7.2));
    const ranked=scores.map((s,i)=>({s,i})).sort((a,b)=>b.s-a.s);
    const best=ranked[0],second=ranked[1],base=(scores.reduce((a,b)=>a+b,0)-best.s)/9;
    if(best.s<Math.max(.23,base+.09)){digits+='?';issues.push(`columna ${col+1} sin marca clara`);}
    else if(second.s>.21&&best.s-second.s<.09){digits+=String(best.i);issues.push(`columna ${col+1} ambigua`);}
    else digits+=String(best.i);
  }
  return {raw:digits,run:digits.includes('?')?'':digits,issues};
}

function runForTemplate(run){
  // La plantilla actual tiene 9 columnas y usaba 1 cuando el DV era K.
  return String(run||'').toUpperCase().replace(/\./g,'').replace(/-/g,'').replace(/\s/g,'').replace(/K/g,'1');
}
function hamming(a,b){
  if(!a||!b||a.length!==b.length)return 99;
  let d=0;for(let i=0;i<a.length;i++)if(a[i]!==b[i])d++;return d;
}
function matchRunToRoster(rawRun,courseId){
  if(!rawRun)return null;
  const roster=state.students.filter(s=>s.courseId===courseId&&s.run);
  const candidates=roster.map(s=>{
    const encoded=runForTemplate(s.run);
    return {student:s,encoded,distance:hamming(rawRun,encoded)};
  }).filter(x=>x.encoded.length===rawRun.length).sort((a,b)=>a.distance-b.distance);
  if(!candidates.length)return null;
  const best=candidates[0],second=candidates[1];
  // exacto, o sugerencia única a 1 dígito. Nunca auto-corrige el RUN leído.
  if(best.distance===0 || (best.distance===1 && (!second || second.distance>1))){
    return {
      exact:best.distance===0,
      distance:best.distance,
      studentId:best.student.id,
      run:best.student.run,
      name:`${best.student.firstName||''} ${best.student.lastName||''}`.trim()||best.student.run
    };
  }
  return null;
}

function bubbleDarkness(im,H,x,y,rCanon){
  const p=applyH(H,x,y),px=applyH(H,x+rCanon,y),py=applyH(H,x,y+rCanon);
  const rx=Math.max(3,dist(p,px)),ry=Math.max(3,dist(p,py));
  const r=Math.max(3,(rx+ry)/2);
  const cx=p.x,cy=p.y,d=im.data,w=im.width,h=im.height;
  let dark=0,count=0;
  const x0=Math.max(0,Math.floor(cx-r)),x1=Math.min(w-1,Math.ceil(cx+r));
  const y0=Math.max(0,Math.floor(cy-r)),y1=Math.min(h-1,Math.ceil(cy+r));
  for(let yy=y0;yy<=y1;yy++)for(let xx=x0;xx<=x1;xx++){
    const dx=(xx-cx)/r,dy=(yy-cy)/r;if(dx*dx+dy*dy>.82)continue;
    const k=(yy*w+xx)*4,lum=.299*d[k]+.587*d[k+1]+.114*d[k+2];
    if(lum<170)dark++;count++;
  }
  return count?dark/count:0;
}
function expectedMarkerNorm(){
  return OMR_TEMPLATE.markers.map(p=>({x:p.x/OMR_TEMPLATE.width,y:p.y/OMR_TEMPLATE.height}));
}
function detectOuterMarkers(im){
  return detectOuterMarkersDetailed(im).markers;
}
function detectOuterMarkersDetailed(im){
  const w=im.width,h=im.height;
  const regs=[[0,0,.36,.28],[.64,0,1,.28],[0,.72,.36,1],[.64,.72,1,1]];
  const expected=expectedMarkerNorm();
  const markers=regs.map((r,i)=>{
    const candidates=findMarkerCandidatesInRegion(im,Math.floor(r[0]*w),Math.floor(r[1]*h),Math.floor(r[2]*w),Math.floor(r[3]*h));
    if(!candidates.length)return null;
    const ex={x:expected[i].x*w,y:expected[i].y*h};
    candidates.forEach(c=>{
      const diag=Math.hypot(w,h);
      const loc=Math.hypot(c.x-ex.x,c.y-ex.y)/diag;
      const idealSide=Math.min(w,h)*.025;
      const sizePenalty=Math.abs(Math.log(Math.max(1,c.side)/idealSide));
      c.rank=c.shapeScore - loc*8 - sizePenalty*.55;
    });
    return candidates.sort((a,b)=>b.rank-a.rank)[0];
  });
  const points=markers.map(m=>m?{x:m.x,y:m.y}:null);
  const geometry=validateMarkerGeometry(points,w,h);
  return {markers:points,raw:markers,geometry};
}
function validateMarkerGeometry(markers,w,h){
  if(markers.some(x=>!x))return {ok:false,reason:'Faltan marcadores exteriores.'};
  const [tl,tr,bl,br]=markers;
  const top=dist(tl,tr),bottom=dist(bl,br),left=dist(tl,bl),right=dist(tr,br);
  if(top<=0||bottom<=0||left<=0||right<=0)return {ok:false,reason:'Geometría incompleta.'};
  const topRatio=Math.min(top,bottom)/Math.max(top,bottom);
  const sideRatio=Math.min(left,right)/Math.max(left,right);
  const expectedAspect=(OMR_TEMPLATE.markers[1].x-OMR_TEMPLATE.markers[0].x)/(OMR_TEMPLATE.markers[2].y-OMR_TEMPLATE.markers[0].y);
  const actualAspect=((top+bottom)/2)/((left+right)/2);
  const aspectRatio=Math.min(actualAspect/expectedAspect,expectedAspect/actualAspect);
  const convex=(tr.x>tl.x && br.x>bl.x && bl.y>tl.y && br.y>tr.y);
  const area=Math.abs((tl.x*tr.y-tr.x*tl.y)+(tr.x*br.y-br.x*tr.y)+(br.x*bl.y-bl.x*br.y)+(bl.x*tl.y-tl.x*bl.y))/2;
  const areaFrac=area/(w*h);
  const ok=convex&&topRatio>.72&&sideRatio>.72&&aspectRatio>.62&&areaFrac>.35;
  let reason='';
  if(!convex)reason='Los marcadores no forman el rectángulo esperado.';
  else if(areaFrac<=.35)reason='La hoja ocupa muy poco del encuadre.';
  else if(topRatio<=.72||sideRatio<=.72)reason='La perspectiva es demasiado irregular.';
  else if(aspectRatio<=.62)reason='La proporción entre marcadores no coincide con la plantilla.';
  return {ok,reason,topRatio,sideRatio,aspectRatio,areaFrac};
}
function findMarkerCandidatesInRegion(im,x0,y0,x1,y1){
  const w=im.width,h=im.height,d=im.data,rw=x1-x0,rh=y1-y0;
  const step=Math.max(1,Math.floor(Math.min(w,h)/1100));
  const gw=Math.ceil(rw/step),gh=Math.ceil(rh/step),seen=new Uint8Array(gw*gh);
  const isDark=(gx,gy)=>{
    const x=x0+gx*step,y=y0+gy*step;if(x>=w||y>=h)return false;
    const k=(y*w+x)*4,lum=.299*d[k]+.587*d[k+1]+.114*d[k+2];return lum<95;
  };
  const out=[];
  for(let gy=0;gy<gh;gy++)for(let gx=0;gx<gw;gx++){
    const idx=gy*gw+gx;if(seen[idx]||!isDark(gx,gy))continue;
    const stack=[idx];seen[idx]=1;let count=0,minx=gx,maxx=gx,miny=gy,maxy=gy;
    while(stack.length){
      const cur=stack.pop(),cy=Math.floor(cur/gw),cx=cur-cy*gw;count++;
      if(cx<minx)minx=cx;if(cx>maxx)maxx=cx;if(cy<miny)miny=cy;if(cy>maxy)maxy=cy;
      for(const [nx,ny] of [[cx-1,cy],[cx+1,cy],[cx,cy-1],[cx,cy+1]]){
        if(nx<0||ny<0||nx>=gw||ny>=gh)continue;
        const ni=ny*gw+nx;
        if(!seen[ni]&&isDark(nx,ny)){seen[ni]=1;stack.push(ni)}
      }
    }
    const bw=(maxx-minx+1)*step,bh=(maxy-miny+1)*step,side=Math.min(bw,bh),ratio=bw/bh;
    const minSide=Math.min(w,h)*.012,maxSide=Math.min(w,h)*.065;
    if(side<minSide||side>maxSide||ratio<.72||ratio>1.38)continue;
    const fill=(count*step*step)/(bw*bh);if(fill<.58)continue;
    const squareness=1-Math.min(1,Math.abs(1-ratio));
    const shapeScore=fill*2+squareness+(side/Math.min(w,h))*4;
    out.push({x:x0+(minx+maxx+1)*step/2,y:y0+(miny+maxy+1)*step/2,side,fill,shapeScore});
  }
  return out;
}
function computeHomography(src,dst){
  const A=[],b=[];
  for(let i=0;i<4;i++){
    const x=src[i].x,y=src[i].y,u=dst[i].x,v=dst[i].y;
    A.push([x,y,1,0,0,0,-u*x,-u*y]);b.push(u);
    A.push([0,0,0,x,y,1,-v*x,-v*y]);b.push(v);
  }
  const h=solveLinear(A,b);if(!h)return null;return [...h,1];
}
function solveLinear(A,b){
  const n=b.length,M=A.map((r,i)=>[...r,b[i]]);
  for(let c=0;c<n;c++){
    let p=c;for(let r=c+1;r<n;r++)if(Math.abs(M[r][c])>Math.abs(M[p][c]))p=r;
    if(Math.abs(M[p][c])<1e-10)return null;[M[c],M[p]]=[M[p],M[c]];
    const div=M[c][c];for(let j=c;j<=n;j++)M[c][j]/=div;
    for(let r=0;r<n;r++)if(r!==c){const f=M[r][c];for(let j=c;j<=n;j++)M[r][j]-=f*M[c][j]}
  }
  return M.map(r=>r[n]);
}
function applyH(H,x,y){const z=H[6]*x+H[7]*y+H[8];return{x:(H[0]*x+H[1]*y+H[2])/z,y:(H[3]*x+H[4]*y+H[5])/z}}
function dist(a,b){return Math.hypot(a.x-b.x,a.y-b.y)}
function loadImageFromUrl(url){return new Promise((res,rej)=>{const im=new Image();im.onload=()=>res(im);im.onerror=()=>rej(new Error('No se pudo abrir la imagen de la página.'));im.src=url})}

function exportBackup(){
  const data={...databaseSnapshot(),version:'0.31',backupType:'light',exportedAt:new Date().toISOString()};
  const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download=`lector-omr-respaldo-ligero-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
async function exportFullBackup(){
  const btn=$('#exportFullBackup');if(btn){btn.disabled=true;btn.textContent='Preparando…'}
  try{
    const keys=await evidenceKeys();
    setBackupProgress(`<strong>Preparando respaldo completo</strong> · ${keys.length} evidencia(s) visual(es)…`);
    const evidence={};
    for(let i=0;i<keys.length;i++){
      const key=keys[i],blob=await evidenceGet(key);
      if(blob)evidence[key]=await blobToDataURL(blob);
      setBackupProgress(`<strong>Preparando respaldo completo</strong> · ${i+1}/${keys.length} evidencia(s) procesadas`);
      await new Promise(r=>setTimeout(r,0));
    }
    const data={...databaseSnapshot(),version:'0.31',backupType:'full',exportedAt:new Date().toISOString(),evidence};
    const blob=new Blob([JSON.stringify(data)],{type:'application/json'}),a=document.createElement('a');
    a.href=URL.createObjectURL(blob);a.download=`lector-omr-respaldo-completo-${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1200);
    setBackupProgress(`<strong>Respaldo completo listo.</strong> ${keys.length} evidencia(s) incluidas.`);
    setTimeout(()=>setBackupProgress('',false),3500);
  }catch(err){
    console.error(err);setBackupProgress('',false);alert('No se pudo crear el respaldo completo: '+err.message);
  }finally{
    if(btn){btn.disabled=false;btn.textContent='Exportar respaldo completo'}
  }
}
async function importBackupFile(file){
  if(!file)return;
  try{
    setBackupProgress('<strong>Leyendo respaldo…</strong>');
    const data=JSON.parse(await file.text());
    if(!data||!Array.isArray(data.courses)||!Array.isArray(data.evaluations))throw new Error('Formato no válido');
    const c=data.courses.length,e=data.evaluations.length,s=Array.isArray(data.students)?data.students.length:0,r=Array.isArray(data.results)?data.results.length:0;
    const evCount=data.evidence&&typeof data.evidence==='object'?Object.keys(data.evidence).length:0;
    const msg=`Respaldo a importar:\n• ${c} curso(s)\n• ${s} estudiante(s)\n• ${e} evaluación(es)\n• ${r} resultado(s)\n• ${evCount} evidencia(s) visual(es)\n\nEsto reemplazará los datos actuales de este navegador. ¿Continuar?`;
    if(!confirm(msg)){setBackupProgress('',false);return}

    state.schemaVersion=Number(data.schemaVersion)||APP_SCHEMA_VERSION;
    state.meta=data.meta||{createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};
    state.settings={...defaults,...(data.settings||{})};
    state.years=Array.isArray(data.years)?data.years:[];
    state.courses=data.courses;
    state.students=Array.isArray(data.students)?data.students:[];state.persons=Array.isArray(data.persons)?data.persons:[];state.enrollments=Array.isArray(data.enrollments)?data.enrollments:[];
    state.evaluations=data.evaluations;
    state.review=Array.isArray(data.review)?data.review:[];
    state.results=Array.isArray(data.results)?data.results:[];state.activity=Array.isArray(data.activity)?data.activity:[];
    migrate();logActivity('backup_imported',`${e} evaluaciones · ${r} resultados · ${evCount} evidencias`,{});persist();

    if(evCount){
      let done=0;
      for(const [key,dataURL] of Object.entries(data.evidence)){
        await evidencePut(key,dataURLToBlob(dataURL));
        done++;
        setBackupProgress(`<strong>Restaurando evidencias</strong> · ${done}/${evCount}`);
        await new Promise(r=>setTimeout(r,0));
      }
    }

    renderStats();renderDashboard();renderCourses();renderCalendar();renderEvaluations();renderReview();renderSettings();
    setBackupProgress(`<strong>Respaldo restaurado correctamente.</strong> ${e} evaluaciones, ${r} resultados y ${evCount} evidencias.`);
    setTimeout(()=>setBackupProgress('',false),4000);
    alert(`Respaldo importado correctamente.\n${e} evaluaciones, ${r} resultados y ${evCount} evidencias restauradas.`);
  }catch(err){
    setBackupProgress('',false);
    alert('No se pudo importar el respaldo: '+err.message);
  }
}
$('#exportBackup').onclick=exportBackup;if($('#exportFullBackup'))$('#exportFullBackup').onclick=exportFullBackup;$('#importBackup').onchange=e=>{importBackupFile(e.target.files?.[0]);e.target.value=''};

if($('#resultsEvaluation'))$('#resultsEvaluation').onchange=renderResults;
if($('#resultsForm'))$('#resultsForm').onchange=renderResults;
if($('#resultsStudent'))$('#resultsStudent').onchange=renderResults;
if($('#resultScopeStudent'))$('#resultScopeStudent').onclick=()=>{resultsScope='student';renderResults()};
if($('#resultScopeCourse'))$('#resultScopeCourse').onclick=()=>{resultsScope='course';renderResults()};
if($('#resultsViewMode'))$('#resultsViewMode').onchange=renderResults;
if($('#refreshResults'))$('#refreshResults').onclick=renderResults;
if($('#exportResultsCsv'))$('#exportResultsCsv').onclick=exportResultsCsv;
if($('#printStudentReports'))$('#printStudentReports').onclick=printStudentReports;
if($('#printCourseReport'))$('#printCourseReport').onclick=printCourseReport;

if($('#runIntegrityCheck'))$('#runIntegrityCheck').onclick=()=>{renderDataIntegrity();alert('Verificación de integridad completada.')};
if($('#runArchitectureCheck'))$('#runArchitectureCheck').onclick=()=>renderArchitectureStatus(true);
$('#settingsYear').onchange=loadSelectedSchoolYear;
$('#addSchoolYear').onclick=addSchoolYear;
$('#deleteSchoolYear').onclick=deleteSchoolYear;
$('#saveSchoolYear').onclick=()=>{
 const year=Number($('#settingsYear').value);if(!Number.isInteger(year))return alert('Selecciona un año válido.');
 const obj={year,start:$('#schoolStart').value,vacStart:$('#vacStart').value,vacEnd:$('#vacEnd').value,end:$('#schoolEnd').value};
 const dates=[obj.start,obj.vacStart,obj.vacEnd,obj.end].filter(Boolean);
 if(dates.some(d=>Number(d.slice(0,4))!==year)&&!confirm(`Hay una o más fechas que no corresponden al año ${year}. ¿Guardar de todos modos?`))return;
 const i=state.years.findIndex(y=>Number(y.year)===year);if(i>=0)state.years[i]=obj;else state.years.push(obj);
 logActivity('school_year_saved',`Calendario ${year}`,{year});persist();renderSettings();renderDashboard();renderCourses();renderCalendar();alert(`Calendario ${year} guardado.`);
};$('#saveSettings').onclick=()=>{state.settings={threshold:Number($('#settingThreshold').value)||60,minGrade:Number($('#settingMinGrade').value)||1,passGrade:Number($('#settingPassGrade').value)||4,maxGrade:Number($('#settingMaxGrade').value)||7};persist();alert('Escala predeterminada guardada.')};
persist();renderStats();renderDashboard();renderCourses();renderCalendar();renderEvaluations();renderScan();renderReview();renderSettings();const rt=$('#runtime');rt.textContent='v0.37 activa';setTimeout(()=>rt.remove(),2500);
