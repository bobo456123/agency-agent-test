/**
 * Todo List 后端 API（最小可运行实现）
 * 技术栈：Express + better-sqlite3
 * 规范：对齐 API_SPEC.md
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const app = express();

// ============================================================
// 数据库初始化
// ============================================================
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'todos.db');

// 确保 data/ 目录存在
fs.mkdirSync(DATA_DIR, { recursive: true });

// 创建数据库连接
const db = new Database(DB_PATH);
// 开启外键约束（良好实践）
db.pragma('journal_mode = WAL');

// 建表（DDL 严格对齐 API_SPEC.md 第 2.1 章）
db.exec(`
CREATE TABLE IF NOT EXISTS todos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT        NOT NULL CHECK (length(title) >= 1 AND length(title) <= 255),
    description     TEXT        CHECK (description IS NULL OR length(description) <= 2000),
    status          TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed')),
    priority        INTEGER     NOT NULL DEFAULT 3
                        CHECK (priority >= 1 AND priority <= 5),
    due_date        TEXT,
    created_at      TEXT        NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT        NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
`);

// 索引（对齐 API_SPEC.md 第 2.2 章）
db.exec(`
CREATE INDEX IF NOT EXISTS idx_todos_status
    ON todos (status);
CREATE INDEX IF NOT EXISTS idx_todos_due_date
    ON todos (due_date);
CREATE INDEX IF NOT EXISTS idx_todos_priority_status
    ON todos (priority, status);
CREATE INDEX IF NOT EXISTS idx_todos_created_at
    ON todos (created_at);
`);

// ============================================================
// 通用工具函数
// ============================================================

/**
 * 创建业务错误对象（带 code/message/HTTP 状态码）
 */
function createApiError(statusCode, code, message, details = {}) {
  const err = new Error(message);
  err.statusCode = statusCode;
  err.code = code;
  err.details = details;
  return err;
}

// 合法的状态枚举
const VALID_STATUSES = ['pending', 'in_progress', 'completed'];

// 合法的排序字段白名单（防止 SQL 注入）
const VALID_SORT_FIELDS = ['created_at', 'updated_at', 'due_date', 'priority', 'status', 'id'];

/**
 * 解析排序参数（对齐 API_SPEC.md 第 3.4 章）
 * 支持 sort=-created_at、sort=-priority,due_date 形式
 * 返回 { orderSql, error }
 */
function parseSortParam(sortStr) {
  // 默认排序：按创建时间降序
  if (!sortStr) {
    return { orderSql: 'created_at DESC' };
  }

  const parts = sortStr.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    return { orderSql: 'created_at DESC' };
  }

  const orderParts = [];
  for (const part of parts) {
    let direction = 'ASC';
    let field = part;
    if (part.startsWith('-')) {
      direction = 'DESC';
      field = part.slice(1);
    }
    // 白名单校验，防止 SQL 注入
    if (!VALID_SORT_FIELDS.includes(field)) {
      return {
        orderSql: null,
        error: createApiError(400, 'INVALID_QUERY_PARAM', `排序字段不合法: ${field}`, { param: 'sort', value: part })
      };
    }
    // 用双引号包裹字段名做标识符引用
    orderParts.push(`"${field}" ${direction}`);
  }

  return { orderSql: orderParts.join(', ') };
}

/**
 * 校验创建/全量更新的请求体
 * 返回 { errors, values }
 */
function validateTodoBody(body, { partial = false } = {}) {
  const errors = [];
  const values = {};

  // title：必填（PUT 全量场景也必填）
  if ('title' in body) {
    if (typeof body.title !== 'string' || body.title.length < 1 || body.title.length > 255) {
      errors.push({ field: 'title', issue: 'title 必须是 1-255 字符的字符串' });
    } else {
      values.title = body.title;
    }
  } else if (!partial) {
    errors.push({ field: 'title', issue: 'title 不能为空' });
  }

  // description：可选
  if ('description' in body && body.description !== null && body.description !== undefined) {
    if (typeof body.description !== 'string' || body.description.length > 2000) {
      errors.push({ field: 'description', issue: 'description 最长 2000 字符' });
    } else {
      values.description = body.description;
    }
  } else if ('description' in body) {
    values.description = null;
  }

  // status：可选，需为合法枚举
  if ('status' in body && body.status !== null && body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      errors.push({ field: 'status', issue: `status 必须是 ${VALID_STATUSES.join(' / ')} 之一` });
    } else {
      values.status = body.status;
    }
  } else if ('status' in body) {
    values.status = null;
  }

  // priority：可选，整数 1-5
  if ('priority' in body && body.priority !== null && body.priority !== undefined) {
    const p = Number(body.priority);
    if (!Number.isInteger(p) || p < 1 || p > 5) {
      errors.push({ field: 'priority', issue: 'priority 必须是 1-5 之间的整数' });
    } else {
      values.priority = p;
    }
  } else if ('priority' in body) {
    values.priority = null;
  }

  // due_date：可选，字符串即可（不做严格 ISO 校验，保持最小实现）
  if ('due_date' in body) {
    if (body.due_date === null || body.due_date === undefined) {
      values.due_date = null;
    } else if (typeof body.due_date === 'string') {
      values.due_date = body.due_date;
    } else {
      errors.push({ field: 'due_date', issue: 'due_date 必须是 ISO 8601 字符串或 null' });
    }
  }

  return { errors, values };
}

// ============================================================
// 中间件
// ============================================================

// 解析 JSON 请求体（捕获非法 JSON）
app.use(express.json({ limit: '1mb' }));

// ============================================================
// 路由：Todo CRUD（对齐 API_SPEC.md 第 1 章）
// ============================================================

// --- 1.2 GET /api/v1/todos — 列表查询 ---
app.get('/api/v1/todos', (req, res, next) => {
  try {
    const { status, priority, keyword } = req.query;

    // 分页参数解析（对齐第 3.3 章）
    let limit = parseInt(req.query.limit, 10);
    if (Number.isNaN(limit)) limit = 20;
    if (limit < 1) limit = 1;
    if (limit > 100) limit = 100;

    let offset = parseInt(req.query.offset, 10);
    if (Number.isNaN(offset)) offset = 0;
    if (offset < 0) offset = 0;

    // status 筛选校验
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return next(createApiError(400, 'INVALID_QUERY_PARAM', `status 必须是 ${VALID_STATUSES.join(' / ')} 之一`, { param: 'status', value: status }));
    }

    // priority 筛选校验
    let priorityVal = null;
    if (priority !== undefined && priority !== '') {
      priorityVal = parseInt(priority, 10);
      if (Number.isNaN(priorityVal) || priorityVal < 1 || priorityVal > 5) {
        return next(createApiError(400, 'INVALID_QUERY_PARAM', 'priority 必须是 1-5 之间的整数', { param: 'priority', value: priority }));
      }
    }

    // 动态构建 WHERE 子句
    const where = [];
    const params = {};
    if (status) {
      where.push('status = @status');
      params.status = status;
    }
    if (priorityVal !== null) {
      where.push('priority = @priority');
      params.priority = priorityVal;
    }
    if (keyword) {
      // 对用户输入中的 LIKE 通配符做转义，避免 % 和 _ 被当作模式匹配符
      // 例如用户传入 "%" 应按字面量匹配，而不是匹配所有记录
      const escaped = String(keyword).replace(/[%_\\]/g, '\\$&');
      where.push("title LIKE @keyword ESCAPE '\\'");
      params.keyword = `%${escaped}%`;
    }

    const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : '';

    // 排序解析（对齐第 3.4 章）
    // 注意：用户需求中 sort 参数是无前缀形式（如 'created_at'），order 单独传 asc/desc
    // 但规范中是 sort=-created_at 形式。这里同时兼容两种用法。
    let orderSql;
    const sortParam = req.query.sort;
    const orderParam = req.query.order;

    if (sortParam && sortParam.includes('-') && sortParam !== '-created_at') {
      // 规范形式：sort=-priority,due_date
      const parsed = parseSortParam(sortParam);
      if (parsed.error) return next(parsed.error);
      orderSql = parsed.orderSql;
    } else if (sortParam && sortParam.startsWith('-')) {
      // sort=-created_at
      const field = sortParam.slice(1);
      if (!VALID_SORT_FIELDS.includes(field)) {
        return next(createApiError(400, 'INVALID_QUERY_PARAM', `排序字段不合法: ${field}`, { param: 'sort', value: sortParam }));
      }
      orderSql = `"${field}" DESC`;
    } else if (sortParam) {
      // 用户需求形式：sort=created_at 配合 order=asc/desc
      if (!VALID_SORT_FIELDS.includes(sortParam)) {
        return next(createApiError(400, 'INVALID_QUERY_PARAM', `排序字段不合法: ${sortParam}`, { param: 'sort', value: sortParam }));
      }
      const direction = (orderParam === 'asc') ? 'ASC' : 'DESC';
      orderSql = `"${sortParam}" ${direction}`;
    } else {
      // 默认：按创建时间降序
      orderSql = '"created_at" DESC';
    }

    params.limit = limit;
    params.offset = offset;

    // 查询总数（用于分页元数据）
    const countSql = `SELECT COUNT(*) AS total FROM todos ${whereSql}`;
    const { total } = db.prepare(countSql).get(params);

    // 查询当前页数据
    const listSql = `
      SELECT id, title, description, status, priority, due_date, created_at, updated_at
      FROM todos
      ${whereSql}
      ORDER BY ${orderSql}
      LIMIT @limit OFFSET @offset
    `;
    const data = db.prepare(listSql).all(params);

    // 分页元数据（对齐第 3.3 章）
    const pagination = {
      total,
      limit,
      offset,
      has_more: (offset + limit) < total,
    };

    res.json({ data, pagination });
  } catch (err) {
    next(err);
  }
});

// --- 1.4 GET /api/v1/todos/:id — 获取单个 ---
app.get('/api/v1/todos/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return next(createApiError(400, 'VALIDATION_ERROR', 'ID 格式不合法', { field: 'id', issue: 'id 必须是正整数' }));
    }

    const todo = db.prepare('SELECT id, title, description, status, priority, due_date, created_at, updated_at FROM todos WHERE id = ?').get(id);
    if (!todo) {
      return next(createApiError(404, 'TODO_NOT_FOUND', `ID 为 ${id} 的 Todo 不存在`, {}));
    }

    res.json({ data: todo });
  } catch (err) {
    next(err);
  }
});

// --- 1.3 POST /api/v1/todos — 创建 ---
app.post('/api/v1/todos', (req, res, next) => {
  try {
    const body = req.body || {};
    const { errors, values } = validateTodoBody(body, { partial: false });

    if (errors.length > 0) {
      return next(createApiError(422, 'VALIDATION_ERROR', '请求参数校验失败', { details: errors }));
    }

    // 应用默认值（对齐第 1.3 章字段说明）
    const title = values.title;
    const description = values.description !== undefined ? values.description : null;
    const status = values.status || 'pending';
    const priority = values.priority !== null && values.priority !== undefined ? values.priority : 3;
    const due_date = values.due_date !== undefined ? values.due_date : null;

    const stmt = db.prepare(`
      INSERT INTO todos (title, description, status, priority, due_date)
      VALUES (?, ?, ?, ?, ?)
    `);
    const info = stmt.run(title, description, status, priority, due_date);

    const todo = db.prepare('SELECT id, title, description, status, priority, due_date, created_at, updated_at FROM todos WHERE id = ?').get(info.lastInsertRowid);

    res.status(201).json({ data: todo });
  } catch (err) {
    next(err);
  }
});

// --- 1.5 PUT /api/v1/todos/:id — 全量更新 ---
app.put('/api/v1/todos/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return next(createApiError(400, 'VALIDATION_ERROR', 'ID 格式不合法', { field: 'id', issue: 'id 必须是正整数' }));
    }

    const body = req.body || {};
    const { errors, values } = validateTodoBody(body, { partial: false });

    if (errors.length > 0) {
      return next(createApiError(422, 'VALIDATION_ERROR', '请求参数校验失败', { details: errors }));
    }

    // 检查记录是否存在
    const existing = db.prepare('SELECT id FROM todos WHERE id = ?').get(id);
    if (!existing) {
      return next(createApiError(404, 'TODO_NOT_FOUND', `ID 为 ${id} 的 Todo 不存在`, {}));
    }

    // 全量更新：未提供的字段使用默认值
    const title = values.title;
    const description = values.description !== undefined ? values.description : null;
    const status = values.status || 'pending';
    const priority = values.priority !== null && values.priority !== undefined ? values.priority : 3;
    const due_date = values.due_date !== undefined ? values.due_date : null;

    // 手动维护 updated_at（不依赖触发器，对齐用户要求）
    db.prepare(`
      UPDATE todos
      SET title = ?, description = ?, status = ?, priority = ?, due_date = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, description, status, priority, due_date, id);

    const todo = db.prepare('SELECT id, title, description, status, priority, due_date, created_at, updated_at FROM todos WHERE id = ?').get(id);
    res.json({ data: todo });
  } catch (err) {
    next(err);
  }
});

// --- 1.6 PATCH /api/v1/todos/:id — 部分更新 ---
app.patch('/api/v1/todos/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return next(createApiError(400, 'VALIDATION_ERROR', 'ID 格式不合法', { field: 'id', issue: 'id 必须是正整数' }));
    }

    const body = req.body || {};
    if (Object.keys(body).length === 0) {
      return next(createApiError(422, 'VALIDATION_ERROR', '请求体不能为空', {}));
    }

    const { errors, values } = validateTodoBody(body, { partial: true });
    if (errors.length > 0) {
      return next(createApiError(422, 'VALIDATION_ERROR', '请求参数校验失败', { details: errors }));
    }

    // 检查记录是否存在
    const existing = db.prepare('SELECT id FROM todos WHERE id = ?').get(id);
    if (!existing) {
      return next(createApiError(404, 'TODO_NOT_FOUND', `ID 为 ${id} 的 Todo 不存在`, {}));
    }

    // 动态构建 SET 子句（仅更新传入的字段）
    const setParts = [];
    const params = [];
    const fieldMap = {
      title: 'title',
      description: 'description',
      status: 'status',
      priority: 'priority',
      due_date: 'due_date',
    };

    for (const [key, column] of Object.entries(fieldMap)) {
      if (key in values) {
        setParts.push(`${column} = ?`);
        params.push(values[key]);
      }
    }

    if (setParts.length === 0) {
      // 没有可更新的字段
      const todo = db.prepare('SELECT id, title, description, status, priority, due_date, created_at, updated_at FROM todos WHERE id = ?').get(id);
      return res.json({ data: todo });
    }

    // 手动维护 updated_at
    setParts.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);

    db.prepare(`UPDATE todos SET ${setParts.join(', ')} WHERE id = ?`).run(...params);

    const todo = db.prepare('SELECT id, title, description, status, priority, due_date, created_at, updated_at FROM todos WHERE id = ?').get(id);
    res.json({ data: todo });
  } catch (err) {
    next(err);
  }
});

// --- 1.7 DELETE /api/v1/todos/:id — 删除单个 ---
app.delete('/api/v1/todos/:id', (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id) || id < 1) {
      return next(createApiError(400, 'VALIDATION_ERROR', 'ID 格式不合法', { field: 'id', issue: 'id 必须是正整数' }));
    }

    const existing = db.prepare('SELECT id FROM todos WHERE id = ?').get(id);
    if (!existing) {
      return next(createApiError(404, 'TODO_NOT_FOUND', `ID 为 ${id} 的 Todo 不存在`, {}));
    }

    db.prepare('DELETE FROM todos WHERE id = ?').run(id);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ============================================================
// 路由：批量操作（对齐 API_SPEC.md 第 1.8 / 1.9 章）
// ============================================================

// --- 1.8 POST /api/v1/todos/batch/delete — 批量删除 ---
app.post('/api/v1/todos/batch/delete', (req, res, next) => {
  try {
    const body = req.body || {};
    const ids = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return next(createApiError(422, 'EMPTY_BATCH_REQUEST', 'ids 列表不能为空且必须为数组', {}));
    }

    // 防止超大请求：限制单次批量操作的数量上限，避免生成超长 SQL 占位符
    // （SQLite 默认最大绑定变量数 999/32766，超过会抛 SQLITE_LIMIT_VARIABLES_NUMBER）
    if (ids.length > 500) {
      return next(createApiError(422, 'BATCH_TOO_LARGE', 'ids 数量超过上限 500', { max: 500, received: ids.length }));
    }

    // 校验每个 id 是正整数
    const invalidIds = ids.filter(id => !Number.isInteger(id) || id < 1);
    if (invalidIds.length > 0) {
      return next(createApiError(422, 'VALIDATION_ERROR', 'ids 中包含非法值', { invalid_ids: invalidIds }));
    }

    // 查询实际存在的 id
    const placeholders = ids.map(() => '?').join(',');
    const existingRows = db.prepare(`SELECT id FROM todos WHERE id IN (${placeholders})`).all(...ids);
    const existingIds = existingRows.map(r => r.id);
    const notFoundIds = ids.filter(id => !existingIds.includes(id));

    // 批量删除
    if (existingIds.length > 0) {
      const delPlaceholders = existingIds.map(() => '?').join(',');
      db.prepare(`DELETE FROM todos WHERE id IN (${delPlaceholders})`).run(...existingIds);
    }

    res.json({
      data: {
        deleted_count: existingIds.length,
        deleted_ids: existingIds,
        not_found_ids: notFoundIds,
      }
    });
  } catch (err) {
    next(err);
  }
});

// --- 1.9 POST /api/v1/todos/batch/complete — 批量标记完成 ---
app.post('/api/v1/todos/batch/complete', (req, res, next) => {
  try {
    const body = req.body || {};
    const ids = body.ids;

    if (!Array.isArray(ids) || ids.length === 0) {
      return next(createApiError(422, 'EMPTY_BATCH_REQUEST', 'ids 列表不能为空且必须为数组', {}));
    }

    // 防止超大请求：限制单次批量操作的数量上限，避免生成超长 SQL 占位符
    // （SQLite 默认最大绑定变量数 999/32766，超过会抛 SQLITE_LIMIT_VARIABLES_NUMBER）
    if (ids.length > 500) {
      return next(createApiError(422, 'BATCH_TOO_LARGE', 'ids 数量超过上限 500', { max: 500, received: ids.length }));
    }

    const invalidIds = ids.filter(id => !Number.isInteger(id) || id < 1);
    if (invalidIds.length > 0) {
      return next(createApiError(422, 'VALIDATION_ERROR', 'ids 中包含非法值', { invalid_ids: invalidIds }));
    }

    const placeholders = ids.map(() => '?').join(',');
    const existingRows = db.prepare(`SELECT id FROM todos WHERE id IN (${placeholders})`).all(...ids);
    const existingIds = existingRows.map(r => r.id);
    const notFoundIds = ids.filter(id => !existingIds.includes(id));

    if (existingIds.length > 0) {
      const updPlaceholders = existingIds.map(() => '?').join(',');
      db.prepare(`UPDATE todos SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id IN (${updPlaceholders})`).run(...existingIds);
    }

    res.json({
      data: {
        updated_count: existingIds.length,
        updated_ids: existingIds,
        not_found_ids: notFoundIds,
      }
    });
  } catch (err) {
    next(err);
  }
});

// ============================================================
// 404 兜底（未匹配的路由）
// ============================================================
app.use((req, res, next) => {
  res.status(404).json({
    code: 'ROUTE_NOT_FOUND',
    message: `未找到路由: ${req.method} ${req.path}`,
    details: {},
  });
});

// ============================================================
// 统一错误处理中间件（对齐用户需求 & API_SPEC.md 第 3 章）
// ============================================================
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // 已知业务错误（通过 createApiError 创建）
  if (err.statusCode && err.code) {
    return res.status(err.statusCode).json({
      code: err.code,
      message: err.message,
      details: err.details,
    });
  }

  // 捕获 better-sqlite3 的约束错误并映射到合适的 HTTP 状态码
  if (err.code === 'SQLITE_CONSTRAINT_CHECK') {
    return res.status(422).json({
      code: 'VALIDATION_ERROR',
      message: '字段校验失败（数据库约束）',
      details: { db_error: err.message },
    });
  }

  if (err.code === 'SQLITE_CONSTRAINT_NOTNULL') {
    return res.status(422).json({
      code: 'VALIDATION_ERROR',
      message: '必填字段缺失',
      details: { db_error: err.message },
    });
  }

  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return res.status(409).json({
      code: 'DUPLICATE_TITLE',
      message: '唯一约束冲突',
      details: { db_error: err.message },
    });
  }

  if (err.code === 'SQLITE_CONSTRAINT') {
    return res.status(422).json({
      code: 'VALIDATION_ERROR',
      message: '数据库约束失败',
      details: { db_error: err.message },
    });
  }

  // express.json() 解析失败
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({
      code: 'INVALID_JSON',
      message: '请求体不是合法的 JSON',
      details: {},
    });
  }

  // 未知错误兜底
  console.error('[INTERNAL_ERROR]', err);
  return res.status(500).json({
    code: 'INTERNAL_ERROR',
    message: '服务器内部错误',
    details: {},
  });
});

// ============================================================
// 导出 app 以便测试；仅在直接执行时启动 HTTP server
// ============================================================
module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`[Todo API] 服务已启动，监听端口: ${PORT}`);
    console.log(`[Todo API] 数据库路径: ${DB_PATH}`);
  });
}
