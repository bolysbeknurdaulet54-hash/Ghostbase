import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authenticate } from '../src/auth.mjs';
import { openDatabase } from '../src/database.mjs';

test('CLI принимает пароль через stdin и создаёт профиль для обычного входа',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'gosdesk-cli-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file=join(dir,'accounts.sqlite');
  const password='local-cli-test-password';
  const email='admin@gosdesk.example';
  const cli=fileURLToPath(new URL('../bin/user-add.mjs',import.meta.url));
  const args=[cli,'--email',email,'--name','Тестовый координатор','--unit','Приёмная','--role','coordinator'];
  const options={env:{...process.env,GOSDESK_DB:file},input:password+'\n',encoding:'utf8'};
  const first=spawnSync(process.execPath,args,options);
  assert.equal(first.status,0,first.stderr);
  assert.ok(!first.stdout.includes(password));
  const db=openDatabase({file});
  try {
    const user=await authenticate(db,email,password);
    assert.equal(user.role,'coordinator');
  } finally { db.close(); }
  assert.equal(spawnSync(process.execPath,args,options).status,1);
});
