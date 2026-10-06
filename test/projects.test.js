const test = require('node:test');
const assert = require('node:assert/strict');
const FPProjects = require('../js/projects.js');

const plan = n => ({ version: 1, walls: [], openings: [], rooms: [], name: n });

test('新增、存檔、切換、重新開啟後還在', async () => {
  const backend = FPProjects.memoryBackend();
  const s = FPProjects.createStore(backend);
  assert.deepEqual(await s.init(), []);
  const a = s.create('我家.jpg', plan('a'), false).id;
  const b = s.create('爸媽家', plan('b'), true).id;
  assert.deepEqual([a, b, s.current], ['p1', 'p2', 'p2']);
  s.save({ ...plan('b2') }, true);
  assert.deepEqual(s.list().map(e => e.name), ['爸媽家', '我家.jpg'], '最近修改的在前面');
  const opened = await s.open(a);
  assert.equal(opened.plan.name, 'a');
  assert.equal(s.current, 'p1');
  await s.flush();
  // 重新整理網頁：從同一個儲存空間讀回來
  const s2 = FPProjects.createStore(backend);
  await s2.init();
  assert.equal(s2.current, 'p1');
  const ob = await s2.open('p2');
  assert.deepEqual([ob.plan.name, ob.edited], ['b2', true]);
});

test('名字重複會加編號；改名；刪除後開最近的專案', async () => {
  const s = FPProjects.createStore(FPProjects.memoryBackend());
  await s.init();
  s.create('我家', plan('1'));
  s.create('我家', plan('2'));
  assert.deepEqual(s.list().map(e => e.name).sort(), ['我家', '我家 (2)']);
  assert.equal(s.rename('p2', '新家'), '新家');
  assert.equal(s.rename('p2', '我家'), '我家 (2)');
  s.create('範例', plan('s'), false, 'sample');
  s.create('範例', plan('s2'), false, 'sample');
  assert.equal(s.list().length, 3, '範例只有一個，重新載入是覆蓋');
  assert.equal(s.remove('sample'), 'p2');
  assert.equal(s.current, 'p2');
  s.remove('p2');
  assert.equal(s.remove('p1'), null);
  assert.equal(s.current, null);
  assert.equal(await s.open('p1'), null);
});

// 記下每次寫入、刪除的 key，用來確認圖片有沒有被重寫
function spyBackend() {
  const b = FPProjects.memoryBackend(), log = [];
  return { log, raw: b, persistent: false, get: b.get, set: (k, v) => { log.push('set ' + k); return b.set(k, v); }, del: k => { log.push('del ' + k); return b.del(k); } };
}
const withImage = (name, image, facades) => ({ ...plan(name), source: { image, pxPerMeter: 50 }, ...(facades ? { facades } : {}) });
const imgWrites = log => log.filter(l => l.startsWith('set img:')).length;

test('圖片和平面圖分開存：圖片沒換就不重寫，換了才寫新的、刪掉舊的', async () => {
  const b = spyBackend(), s = FPProjects.createStore(b);
  await s.init();
  const id = s.create('我家', withImage('v1', 'data:AAA'), false).id;
  await s.flush();
  assert.equal(imgWrites(b.log), 1);
  const rec = await b.raw.get('plan:' + id);
  assert.equal(rec.split, 1);
  assert.equal(JSON.stringify(rec).includes('data:AAA'), false, '平面圖那一筆不含圖片');
  // 只改平面圖：圖片不重寫
  b.log.length = 0;
  await s.save(withImage('v2', 'data:AAA'), true);
  await s.flush();
  assert.equal(imgWrites(b.log), 0);
  assert.deepEqual(b.log.filter(l => l.includes('img:')), []);
  // 換一張圖：寫新的，舊的刪掉
  b.log.length = 0;
  await s.save(withImage('v3', 'data:BBB'), true);
  assert.equal(imgWrites(b.log), 1);
  assert.equal(b.log.filter(l => l.startsWith('del img:')).length, 1);
  // 重新整理網頁後讀回來，圖片接得回去；再存一次也不會重寫圖片
  const s2 = FPProjects.createStore(b);
  await s2.init();
  const o = await s2.open(id);
  assert.deepEqual([o.plan.name, o.plan.source.image, o.plan.source.pxPerMeter], ['v3', 'data:BBB', 50]);
  b.log.length = 0;
  await s2.save(o.plan, true);
  assert.equal(imgWrites(b.log), 0);
});

test('整棟房子：每一層的原圖和外觀圖都分開存，相同的圖只存一份；刪除專案時一起刪掉', async () => {
  const b = spyBackend(), s = FPProjects.createStore(b);
  await s.init();
  const building = { version: 1, type: 'building', active: 1, floors: [
    { id: 'f1', name: '1 樓', offset: [0, 0], plan: withImage('1F', 'data:PDF', [{ id: 'fa1', side: 'front', image: 'data:FRONT' }]) },
    { id: 'f2', name: '2 樓', offset: [0, 0], plan: withImage('2F', 'data:PDF') }
  ] };
  const id = s.create('透天', building, false).id;
  await s.flush();
  assert.equal(imgWrites(b.log), 2, '兩層共用同一張 PDF 圖 + 一張外觀圖');
  assert.equal(building.floors[0].plan.source.image, 'data:PDF', '不會改到傳進來的資料');
  const o = (await s.open(id)).plan;
  assert.deepEqual(o.floors.map(f => f.plan.source.image), ['data:PDF', 'data:PDF']);
  assert.equal(o.floors[0].plan.facades[0].image, 'data:FRONT');
  assert.equal(o.active, 1);
  s.remove(id);
  await s.flush();
  assert.equal(await b.raw.get('plan:' + id), null);
  assert.equal(b.log.filter(l => l.startsWith('del img:')).length, 2);
});

test('舊版存檔（圖片直接放在平面圖裡）讀得到，下次存檔換成新格式', async () => {
  const b = spyBackend();
  await b.raw.set('index', [{ id: 'p1', name: '舊的', updated: 1, edited: true }]);
  await b.raw.set('current', 'p1');
  await b.raw.set('plan:p1', withImage('old', 'data:OLD'));
  const s = FPProjects.createStore(b);
  await s.init();
  const o = await s.open('p1');
  assert.deepEqual([o.plan.name, o.plan.source.image, o.edited], ['old', 'data:OLD', true]);
  await s.save(o.plan, true);
  assert.equal((await b.raw.get('plan:p1')).split, 1);
  assert.equal((await s.open('p1')).plan.source.image, 'data:OLD');
});

test('連續存檔：還沒開始寫的會合併成最後一筆；刪除後重建同一個 id 不會被刪掉', async () => {
  const b = spyBackend(), s = FPProjects.createStore(b);
  await s.init();
  const id = s.create('範例', withImage('v0', 'data:A'), false, 'sample').id;
  for (let i = 1; i <= 20; i++) s.save(withImage('v' + i, 'data:A'), true);
  await s.flush();
  assert.ok(b.log.filter(l => l === 'set plan:sample').length <= 2, b.log.join(', '));
  assert.equal((await s.open(id)).plan.name, 'v20');
  // 存檔還在排隊時刪除，再馬上重建
  s.save(withImage('x', 'data:A'), true);
  s.remove(id);
  s.create('範例', withImage('new', 'data:B'), false, 'sample');
  s.save(withImage('new2', 'data:B'), false);
  await s.flush();
  const o = await s.open('sample');
  assert.deepEqual([o.plan.name, o.plan.source.image], ['new2', 'data:B']);
});
