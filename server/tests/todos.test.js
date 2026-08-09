/**
 * Todo List 后端集成测试
 *
 * 依赖：jest + supertest
 * 安装：pnpm add -D jest supertest
 * 运行：pnpm test （在 server/ 目录下）
 *
 * 测试隔离策略：
 *   better-sqlite3 是文件型数据库，index.js 启动时会在 server/data/todos.db 创建库。
 *   本测试在 beforeEach 中直接打开同一库文件，清空 todos 表并重置 AUTOINCREMENT 序列，
 *   保证每个用例拥有干净的数据库状态，互不干扰。
 *   afterAll 关闭测试自身打开的 db 句柄。
 *
 * 被测对象：通过 require('../index.js') 获取 Express app，
 *   使用 supertest(app) 做 HTTP 注入测试，不监听真实端口。
 */

const path = require('path');
const Database = require('better-sqlite3');
const request = require('supertest');
const app = require('../index.js');

// 测试专用的 db 句柄，用于隔离清理（与 index.js 打开同一个文件）
const DB_PATH = path.join(__dirname, '..', 'data', 'todos.db');
const db = new Database(DB_PATH);

/**
 * 辅助：直接往数据库插入一条 todo，返回插入的完整记录。
 * 用于在测试中快速构造前置数据，绕过 API。
 */
function insertTodo(overrides = {}) {
  const defaults = {
    title: '测试 Todo',
    description: null,
    status: 'pending',
    priority: 3,
    due_date: null,
  };
  const row = { ...defaults, ...overrides };
  const info = db.prepare(`
    INSERT INTO todos (title, description, status, priority, due_date)
    VALUES (?, ?, ?, ?, ?)
  `).run(row.title, row.description, row.status, row.priority, row.due_date);
  return db.prepare('SELECT * FROM todos WHERE id = ?').get(info.lastInsertRowid);
}

afterAll(() => {
  db.close();
});

beforeEach(() => {
  // 清空表 + 重置自增序列，确保每个用例数据独立
  db.prepare('DELETE FROM todos').run();
  db.prepare("DELETE FROM sqlite_sequence WHERE name='todos'").run();
});

// ============================================================
// POST /api/v1/todos — 创建
// ============================================================
describe('POST /api/v1/todos', () => {
  test('正常创建（仅 title）→ 201，返回默认值', async () => {
    const res = await request(app)
      .post('/api/v1/todos')
      .send({ title: '买牛奶' })
      .expect(201);

    const todo = res.body.data;
    expect(todo.id).toBeDefined();
    expect(todo.title).toBe('买牛奶');
    expect(todo.description).toBeNull();
    expect(todo.status).toBe('pending');
    expect(todo.priority).toBe(3);
    expect(todo.due_date).toBeNull();
    expect(todo.created_at).toBeDefined();
    expect(todo.updated_at).toBeDefined();
  });

  test('正常创建（全部字段）→ 201，返回完整记录', async () => {
    const res = await request(app)
      .post('/api/v1/todos')
      .send({
        title: '写测试',
        description: '编写集成测试',
        status: 'in_progress',
        priority: 5,
        due_date: '2026-08-15T18:00:00Z',
      })
      .expect(201);

    const todo = res.body.data;
    expect(todo.title).toBe('写测试');
    expect(todo.description).toBe('编写集成测试');
    expect(todo.status).toBe('in_progress');
    expect(todo.priority).toBe(5);
    expect(todo.due_date).toBe('2026-08-15T18:00:00Z');
  });

  test('缺 title → 422 + 错误格式', async () => {
    const res = await request(app)
      .post('/api/v1/todos')
      .send({})
      .expect(422);

    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(res.body.message).toBeDefined();
  });

  test('非法 status（如 foo）→ 422（应用层校验拦截）', async () => {
    const res = await request(app)
      .post('/api/v1/todos')
      .send({ title: '测试', status: 'foo' })
      .expect(422);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  test('非法 priority（如 99）→ 422（应用层校验拦截）', async () => {
    const res = await request(app)
      .post('/api/v1/todos')
      .send({ title: '测试', priority: 99 })
      .expect(422);

    expect(res.body.code).toBe('VALIDATION_ERROR');
  });
});

// ============================================================
// GET /api/v1/todos — 列表查询
// ============================================================
describe('GET /api/v1/todos', () => {
  test('空列表 → 200，data 为空数组，total 为 0', async () => {
    const res = await request(app)
      .get('/api/v1/todos')
      .expect(200);

    expect(res.body.data).toEqual([]);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.has_more).toBe(false);
  });

  test('插入若干条后默认查询 → 返回正确数量，按 created_at 降序', async () => {
    insertTodo({ title: '第一条' });
    insertTodo({ title: '第二条' });
    insertTodo({ title: '第三条' });

    const res = await request(app)
      .get('/api/v1/todos')
      .expect(200);

    expect(res.body.data).toHaveLength(3);
    expect(res.body.pagination.total).toBe(3);

    // 默认按 created_at DESC，第一条插入的 id 最小，应该排在最后
    const ids = res.body.data.map((t) => t.id);
    expect(ids).toEqual([3, 2, 1]);
  });

  test('?status=completed 筛选 → 只返回 completed 的记录', async () => {
    insertTodo({ title: '待办 A', status: 'pending' });
    insertTodo({ title: '待办 B', status: 'completed' });
    insertTodo({ title: '待办 C', status: 'completed' });

    const res = await request(app)
      .get('/api/v1/todos?status=completed')
      .expect(200);

    expect(res.body.data).toHaveLength(2);
    res.body.data.forEach((t) => {
      expect(t.status).toBe('completed');
    });
    expect(res.body.pagination.total).toBe(2);
  });

  test('?limit=2&offset=0 分页 → 验证 data.length、total、has_more', async () => {
    insertTodo({ title: 'A' });
    insertTodo({ title: 'B' });
    insertTodo({ title: 'C' });
    insertTodo({ title: 'D' });
    insertTodo({ title: 'E' });

    const res = await request(app)
      .get('/api/v1/todos?limit=2&offset=0')
      .expect(200);

    expect(res.body.data).toHaveLength(2);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.limit).toBe(2);
    expect(res.body.pagination.offset).toBe(0);
    expect(res.body.pagination.has_more).toBe(true);
  });

  test('?limit=2&offset=4 分页第二页末尾 → has_more 为 false', async () => {
    insertTodo({ title: 'A' });
    insertTodo({ title: 'B' });
    insertTodo({ title: 'C' });
    insertTodo({ title: 'D' });
    insertTodo({ title: 'E' });

    const res = await request(app)
      .get('/api/v1/todos?limit=2&offset=4')
      .expect(200);

    expect(res.body.data).toHaveLength(1);
    expect(res.body.pagination.total).toBe(5);
    expect(res.body.pagination.has_more).toBe(false);
  });

  test('?sort=priority&order=asc 排序 → 按 priority 升序', async () => {
    insertTodo({ title: '低', priority: 1 });
    insertTodo({ title: '高', priority: 5 });
    insertTodo({ title: '中', priority: 3 });

    const res = await request(app)
      .get('/api/v1/todos?sort=priority&order=asc')
      .expect(200);

    const priorities = res.body.data.map((t) => t.priority);
    expect(priorities).toEqual([1, 3, 5]);
  });
});

// ============================================================
// GET /api/v1/todos/:id — 单个查询
// ============================================================
describe('GET /api/v1/todos/:id', () => {
  test('存在的 id → 200，返回完整记录', async () => {
    const created = insertTodo({ title: '查找我' });

    const res = await request(app)
      .get(`/api/v1/todos/${created.id}`)
      .expect(200);

    expect(res.body.data.id).toBe(created.id);
    expect(res.body.data.title).toBe('查找我');
  });

  test('不存在的 id → 404 + 错误格式', async () => {
    const res = await request(app)
      .get('/api/v1/todos/99999')
      .expect(404);

    expect(res.body.code).toBe('TODO_NOT_FOUND');
    expect(res.body.message).toBeDefined();
  });
});

// ============================================================
// PUT /api/v1/todos/:id — 全量更新
// ============================================================
describe('PUT /api/v1/todos/:id', () => {
  test('全量更新 → 200，updated_at 被刷新', async () => {
    const created = insertTodo({ title: '旧标题', priority: 2 });

    const res = await request(app)
      .put(`/api/v1/todos/${created.id}`)
      .send({
        title: '新标题',
        description: '更新后的描述',
        status: 'completed',
        priority: 5,
        due_date: '2026-12-31T23:59:59Z',
      })
      .expect(200);

    const todo = res.body.data;
    expect(todo.title).toBe('新标题');
    expect(todo.description).toBe('更新后的描述');
    expect(todo.status).toBe('completed');
    expect(todo.priority).toBe(5);
    expect(todo.due_date).toBe('2026-12-31T23:59:59Z');
    // created_at 不应变
    expect(todo.created_at).toBe(created.created_at);
    // updated_at 应被刷新（CURRENT_TIMESTAMP 重新生成）
    expect(todo.updated_at).toBeDefined();
  });

  test('更新不存在的 id → 404', async () => {
    const res = await request(app)
      .put('/api/v1/todos/99999')
      .send({ title: '不存在' })
      .expect(404);

    expect(res.body.code).toBe('TODO_NOT_FOUND');
  });
});

// ============================================================
// PATCH /api/v1/todos/:id — 部分更新
// ============================================================
describe('PATCH /api/v1/todos/:id', () => {
  test('部分更新（只改 status）→ 200，其他字段不变', async () => {
    const created = insertTodo({
      title: '原标题',
      description: '原描述',
      status: 'pending',
      priority: 4,
    });

    const res = await request(app)
      .patch(`/api/v1/todos/${created.id}`)
      .send({ status: 'completed' })
      .expect(200);

    const todo = res.body.data;
    expect(todo.status).toBe('completed');
    // 其他字段应保持不变
    expect(todo.title).toBe('原标题');
    expect(todo.description).toBe('原描述');
    expect(todo.priority).toBe(4);
  });

  test('更新不存在的 id → 404', async () => {
    const res = await request(app)
      .patch('/api/v1/todos/99999')
      .send({ status: 'completed' })
      .expect(404);

    expect(res.body.code).toBe('TODO_NOT_FOUND');
  });
});

// ============================================================
// DELETE /api/v1/todos/:id — 删除
// ============================================================
describe('DELETE /api/v1/todos/:id', () => {
  test('存在的 id → 204，无响应体', async () => {
    const created = insertTodo({ title: '删掉我' });

    await request(app)
      .delete(`/api/v1/todos/${created.id}`)
      .expect(204);
  });

  test('删除后再次 GET 同一 id → 404', async () => {
    const created = insertTodo({ title: '删掉我' });

    await request(app)
      .delete(`/api/v1/todos/${created.id}`)
      .expect(204);

    const res = await request(app)
      .get(`/api/v1/todos/${created.id}`)
      .expect(404);

    expect(res.body.code).toBe('TODO_NOT_FOUND');
  });

  test('删除不存在的 id → 404', async () => {
    const res = await request(app)
      .delete('/api/v1/todos/99999')
      .expect(404);

    expect(res.body.code).toBe('TODO_NOT_FOUND');
  });
});
