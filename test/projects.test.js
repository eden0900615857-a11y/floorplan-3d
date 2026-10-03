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
