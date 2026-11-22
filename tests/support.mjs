import { once } from 'node:events';
import { openDatabase } from '../src/database.mjs';
import { makeServer } from '../src/http.mjs';

export const initialTime = Date.UTC(2026, 8, 16, 12, 0, 0);
export const sample = {
  serviceId:'signature', priority:'high', subject:'Продлить подпись отдела',
  description:'Нужен новый сертификат для подписания межведомственных писем.'
};

export async function fixture(t, { demo=true } = {}) {
  const db = openDatabase({ demo, now:initialTime });
  let time = initialTime;
  const server = makeServer({ db, demo, clock:()=>time });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const url = 'http://127.0.0.1:'+server.address().port;
  t.after(async () => {
    await new Promise(resolve=>server.close(resolve));
    db.close();
  });
  async function request(path, { method='GET', body, cookie, headers={} }={}) {
    const options = { method,headers:{...headers} };
    if (cookie) options.headers.Cookie = cookie;
    if (body !== undefined) {
      options.headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(body);
    }
    const response = await fetch(url+path,options);
    const content = (response.headers.get('content-type')??'').includes('json') ? await response.json() : await response.text();
    return { status:response.status, data:content, headers:response.headers };
  }
  async function profile(id) {
    const result = await request('/api/session/demo',{ method:'POST',body:{profileId:id} });
    const cookie = result.headers.get('set-cookie').split(';')[0];
    return (path, method='GET', body) => request(path,{ method,body,cookie });
  }
  return { db,url,request,profile,advance(ms) { time+=ms; } };
}
