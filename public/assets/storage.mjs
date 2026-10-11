let database;
export function openStorage() {
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('lineyar-navigator',1);
    request.onupgradeneeded=()=>{
      request.result.createObjectStore('sessions',{keyPath:'id'});
      const points=request.result.createObjectStore('points',{keyPath:['routeId','seq']});
      points.createIndex('route','routeId');
    };
    request.onsuccess=()=>{database=request.result;resolve();};
    request.onerror=()=>reject(new Error('ذخیره‌سازی مرورگر در دسترس نیست. ضبط شروع نشد.'));
  });
}
function transaction(stores,work) {
  return new Promise((resolve,reject)=>{
    const tx=database.transaction(stores,'readwrite');
    work(tx);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(new Error('ذخیره روی دستگاه انجام نشد؛ فضای خالی و تنظیمات مرورگر را بررسی کنید.'));
    tx.onabort=()=>reject(new Error('ذخیره روی دستگاه متوقف شد.'));
  });
}
export function saveSession(s,p=null) {
  return transaction(['sessions','points'],tx=>{
    tx.objectStore('sessions').put(s);
    if(p) tx.objectStore('points').put({...p,routeId:s.id});
  });
}
export function saveBatch(s,list) {
  return transaction(['sessions','points'],tx=>{
    tx.objectStore('sessions').put(s);
    for(const p of list)tx.objectStore('points').put({...p,routeId:s.id});
  });
}
function read(store,request) {
  return new Promise((resolve,reject)=>{
    const q=request(database.transaction(store).objectStore(store));
    q.onsuccess=()=>resolve(q.result); q.onerror=()=>reject(new Error('خواندن دادهٔ دستگاه انجام نشد.'));
  });
}
export async function sessions(owner) { return (await read('sessions',s=>s.getAll())).filter(s=>s.owner===owner); }
export function getPoints(id) { return read('points',s=>s.index('route').getAll(id)); }
export function removeSession(id) {
  return transaction(['sessions','points'],tx=>{
    tx.objectStore('sessions').delete(id);
    const q=tx.objectStore('points').index('route').openCursor(IDBKeyRange.only(id));
    q.onsuccess=()=>{ const cursor=q.result;if(cursor){cursor.delete();cursor.continue();} };
  });
}
