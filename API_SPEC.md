# Todo List 后端 API 规范文档

> 版本：v1.0  
> 技术栈：SQLite（文件型轻量级数据库）  
> 适用场景：Todo List 小型应用的前后端协作

---

## 目录

- [1. API 端点规范](#1-api-端点规范)
  - [1.1 通用约定](#11-通用约定)
  - [1.2 GET /api/v1/todos — 获取 Todo 列表](#12-get-apiv1todos--获取-todo-列表)
  - [1.3 POST /api/v1/todos — 创建 Todo](#13-post-apiv1todos--创建-todo)
  - [1.4 GET /api/v1/todos/{id} — 获取单个 Todo](#14-get-apiv1todosid--获取单个-todo)
  - [1.5 PUT /api/v1/todos/{id} — 全量更新 Todo](#15-put-apiv1todosid--全量更新-todo)
  - [1.6 PATCH /api/v1/todos/{id} — 部分更新 Todo](#16-patch-apiv1todosid--部分更新-todo)
  - [1.7 DELETE /api/v1/todos/{id} — 删除单个 Todo](#17-delete-apiv1todosid--删除单个-todo)
  - [1.8 POST /api/v1/todos/batch/delete — 批量删除](#18-post-apiv1todosbatchdelete--批量删除)
  - [1.9 POST /api/v1/todos/batch/complete — 批量标记完成](#19-post-apiv1todosbatchcomplete--批量标记完成)
- [2. 数据库 Schema](#2-数据库-schema)
  - [2.1 todos 表 DDL](#21-todos-表-ddl)
  - [2.2 索引定义](#22-索引定义)
  - [2.3 updated_at 自动维护触发器](#23-updated_at-自动维护触发器)
  - [2.4 时间字段维护说明](#24-时间字段维护说明)
- [3. 错误处理与分页建议](#3-错误处理与分页建议)
  - [3.1 统一错误响应格式](#31-统一错误响应格式)
  - [3.2 业务错误码映射表](#32-业务错误码映射表)
  - [3.3 分页方案](#33-分页方案)
  - [3.4 排序建议](#34-排序建议)
  - [3.5 筛选建议](#35-筛选建议)
- [附录：数据模型字段说明](#附录数据模型字段说明)

---

## 1. API 端点规范

### 1.1 通用约定

| 项目         | 约定                                                         |
| ------------ | ------------------------------------------------------------ |
| Base URL     | `/api/v1`                                                    |
| 数据格式     | `application/json; charset=utf-8`                            |
| 认证方式     | Bearer Token（`Authorization: Bearer <token>`），具体方案由项目决定 |
| 时间格式     | ISO 8601（UTC），如 `2026-08-09T12:30:00Z`                   |
| ID 类型      | INTEGER 自增主键                                             |
| 空值处理     | 可选字段不传时为 `null`，不要传空字符串                       |

### 1.2 GET /api/v1/todos — 获取 Todo 列表

**功能说明**：分页查询当前用户的 Todo 列表，支持按状态、优先级筛选及多字段排序。

**查询参数**：

| 参数       | 类型    | 必填 | 默认值   | 说明                                            |
| ---------- | ------- | ---- | -------- | ----------------------------------------------- |
| `status`   | string  | 否   | -        | 筛选状态：`pending` / `in_progress` / `completed` |
| `priority` | integer | 否   | -        | 筛选优先级（1-5）                                |
| `keyword`  | string  | 否   | -        | 模糊搜索 title 字段                              |
| `sort`     | string  | 否   | `-created_at` | 排序字段，前缀 `-` 表示降序，支持多字段逗号分隔，如 `-priority,due_date` |
| `limit`    | integer | 否   | `20`     | 每页条数，最大 100                               |
| `offset`   | integer | 否   | `0`      | 偏移量                                           |

**请求示例**：

```
GET /api/v1/todos?status=pending&sort=-priority,-due_date&limit=20&offset=0
```

**响应示例（200 OK）**：

```json
{
  "data": [
    {
      "id": 1,
      "title": "完成 API 设计文档",
      "description": "编写 Todo List 后端的 API 规范",
      "status": "in_progress",
      "priority": 4,
      "due_date": "2026-08-10T18:00:00Z",
      "created_at": "2026-08-09T08:00:00Z",
      "updated_at": "2026-08-09T10:30:00Z"
    },
    {
      "id": 2,
      "title": "采购办公用品",
      "description": null,
      "status": "pending",
      "priority": 2,
      "due_date": null,
      "created_at": "2026-08-08T14:00:00Z",
      "updated_at": "2026-08-08T14:00:00Z"
    }
  ],
  "pagination": {
    "total": 42,
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}
```

**HTTP 状态码**：

| 状态码 | 含义               |
| ------ | ------------------ |
| 200    | 查询成功           |
| 400    | 查询参数格式不合法 |
| 500    | 服务器内部错误     |

---

### 1.3 POST /api/v1/todos — 创建 Todo

**功能说明**：创建一条新的 Todo 记录。

**请求体**：

```json
{
  "title": "编写单元测试",
  "description": "覆盖 todos 模块的 CRUD 逻辑",
  "status": "pending",
  "priority": 3,
  "due_date": "2026-08-12T18:00:00Z"
}
```

**字段说明**：

| 字段          | 类型    | 必填 | 默认值     | 约束                           |
| ------------- | ------- | ---- | ---------- | ------------------------------ |
| `title`       | string  | 是   | -          | 非空，1-255 字符               |
| `description` | string  | 否   | `null`     | 最长 2000 字符                 |
| `status`      | string  | 否   | `pending`  | 枚举：`pending` / `in_progress` / `completed` |
| `priority`    | integer | 否   | `3`        | 整数 1-5                       |
| `due_date`    | string  | 否   | `null`     | ISO 8601 时间字符串            |

**响应示例（201 Created）**：

```json
{
  "data": {
    "id": 3,
    "title": "编写单元测试",
    "description": "覆盖 todos 模块的 CRUD 逻辑",
    "status": "pending",
    "priority": 3,
    "due_date": "2026-08-12T18:00:00Z",
    "created_at": "2026-08-09T11:00:00Z",
    "updated_at": "2026-08-09T11:00:00Z"
  }
}
```

**HTTP 状态码**：

| 状态码 | 含义                       |
| ------ | -------------------------- |
| 201    | 创建成功                   |
| 400    | 请求体格式错误（非合法 JSON） |
| 422    | 字段校验失败               |
| 500    | 服务器内部错误             |

---

### 1.4 GET /api/v1/todos/{id} — 获取单个 Todo

**功能说明**：根据 ID 获取单条 Todo 详情。

**路径参数**：

| 参数 | 类型    | 说明        |
| ---- | ------- | ----------- |
| `id` | integer | Todo 的 ID |

**响应示例（200 OK）**：

```json
{
  "data": {
    "id": 1,
    "title": "完成 API 设计文档",
    "description": "编写 Todo List 后端的 API 规范",
    "status": "in_progress",
    "priority": 4,
    "due_date": "2026-08-10T18:00:00Z",
    "created_at": "2026-08-09T08:00:00Z",
    "updated_at": "2026-08-09T10:30:00Z"
  }
}
```

**HTTP 状态码**：

| 状态码 | 含义           |
| ------ | -------------- |
| 200    | 查询成功       |
| 400    | ID 格式不合法  |
| 404    | Todo 不存在    |
| 500    | 服务器内部错误 |

---

### 1.5 PUT /api/v1/todos/{id} — 全量更新 Todo

**功能说明**：对指定 Todo 进行全量替换更新。未提供的可选字段会被重置为默认值或 `null`。

**请求体**：

```json
{
  "title": "完成 API 设计文档（修订版）",
  "description": "已更新文档内容",
  "status": "completed",
  "priority": 5,
  "due_date": "2026-08-10T18:00:00Z"
}
```

**响应示例（200 OK）**：

```json
{
  "data": {
    "id": 1,
    "title": "完成 API 设计文档（修订版）",
    "description": "已更新文档内容",
    "status": "completed",
    "priority": 5,
    "due_date": "2026-08-10T18:00:00Z",
    "created_at": "2026-08-09T08:00:00Z",
    "updated_at": "2026-08-09T12:00:00Z"
  }
}
```

**HTTP 状态码**：

| 状态码 | 含义                       |
| ------ | -------------------------- |
| 200    | 更新成功                   |
| 400    | 请求体格式错误             |
| 404    | Todo 不存在                |
| 422    | 字段校验失败               |
| 500    | 服务器内部错误             |

---

### 1.6 PATCH /api/v1/todos/{id} — 部分更新 Todo

**功能说明**：对指定 Todo 进行部分更新，仅传需要修改的字段。

**请求体（示例：仅修改状态）**：

```json
{
  "status": "completed"
}
```

**响应示例（200 OK）**：

```json
{
  "data": {
    "id": 1,
    "title": "完成 API 设计文档",
    "description": "编写 Todo List 后端的 API 规范",
    "status": "completed",
    "priority": 4,
    "due_date": "2026-08-10T18:00:00Z",
    "created_at": "2026-08-09T08:00:00Z",
    "updated_at": "2026-08-09T12:15:00Z"
  }
}
```

**HTTP 状态码**：

| 状态码 | 含义                       |
| ------ | -------------------------- |
| 200    | 更新成功                   |
| 400    | 请求体格式错误             |
| 404    | Todo 不存在                |
| 422    | 字段校验失败               |
| 500    | 服务器内部错误             |

---

### 1.7 DELETE /api/v1/todos/{id} — 删除单个 Todo

**功能说明**：根据 ID 删除一条 Todo（物理删除）。

**响应**：无响应体

**HTTP 状态码**：

| 状态码 | 含义           |
| ------ | -------------- |
| 204    | 删除成功       |
| 400    | ID 格式不合法  |
| 404    | Todo 不存在    |
| 500    | 服务器内部错误 |

---

### 1.8 POST /api/v1/todos/batch/delete — 批量删除

**功能说明**：根据 ID 列表批量删除 Todo。

**请求体**：

```json
{
  "ids": [1, 2, 5, 8]
}
```

**响应示例（200 OK）**：

```json
{
  "data": {
    "deleted_count": 4,
    "deleted_ids": [1, 2, 5, 8],
    "not_found_ids": []
  }
}
```

**HTTP 状态码**：

| 状态码 | 含义                       |
| ------ | -------------------------- |
| 200    | 批量删除完成（含部分未找到）|
| 400    | 请求体格式错误             |
| 422    | ids 为空或包含非法值       |
| 500    | 服务器内部错误             |

---

### 1.9 POST /api/v1/todos/batch/complete — 批量标记完成

**功能说明**：将多个 Todo 的状态批量设为 `completed`。

**请求体**：

```json
{
  "ids": [3, 7, 12]
}
```

**响应示例（200 OK）**：

```json
{
  "data": {
    "updated_count": 3,
    "updated_ids": [3, 7, 12],
    "not_found_ids": []
  }
}
```

**HTTP 状态码**：

| 状态码 | 含义                       |
| ------ | -------------------------- |
| 200    | 批量更新完成               |
| 400    | 请求体格式错误             |
| 422    | ids 为空或包含非法值       |
| 500    | 服务器内部错误             |

---

## 2. 数据库 Schema

### 2.1 todos 表 DDL

```sql
-- ============================================================
-- Todo List 主表
-- 数据库：SQLite
-- ============================================================
CREATE TABLE IF NOT EXISTS todos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    title           TEXT        NOT NULL CHECK (length(title) >= 1 AND length(title) <= 255),
    description     TEXT        CHECK (description IS NULL OR length(description) <= 2000),
    status          TEXT        NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'in_progress', 'completed')),
    priority        INTEGER     NOT NULL DEFAULT 3
                        CHECK (priority >= 1 AND priority <= 5),
    due_date        TEXT,                          -- ISO 8601 格式，如 '2026-08-10T18:00:00Z'
    created_at      TEXT        NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
    updated_at      TEXT        NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- SQLite 没有原生的 DATETIME 类型，使用 TEXT 存储 ISO 8601 字符串。
-- 这样做的好处：
--   1. 可读性好，便于调试
--   2. ISO 8601 格式天然支持字符串排序（按字典序排序即为时间排序）
--   3. 跨平台兼容性好
```

### 2.2 索引定义

```sql
-- ============================================================
-- 索引
-- ============================================================

-- status 字段：列表查询中高频筛选条件
CREATE INDEX IF NOT EXISTS idx_todos_status
    ON todos (status);

-- due_date 字段：按截止日期排序和筛选
CREATE INDEX IF NOT EXISTS idx_todos_due_date
    ON todos (due_date);

-- priority + status 复合索引：常见组合查询（如「高优先级且未完成」）
CREATE INDEX IF NOT EXISTS idx_todos_priority_status
    ON todos (priority, status);

-- created_at：默认排序字段
CREATE INDEX IF NOT EXISTS idx_todos_created_at
    ON todos (created_at);
```

### 2.3 updated_at 自动维护触发器

```sql
-- ============================================================
-- 触发器：更新记录时自动刷新 updated_at
-- ============================================================
CREATE TRIGGER IF NOT EXISTS trg_todos_updated_at
    AFTER UPDATE ON todos
    FOR EACH ROW
BEGIN
    -- 仅当 updated_at 不是本次 UPDATE 语句显式赋值时才自动刷新，
    -- 避免应用层主动设置 updated_at 时被覆盖。
    -- 注意：如果 UPDATE 语句本身就包含了 updated_at 列的赋值，
    --        可以通过 NEW.updated_at != OLD.updated_at 判断来跳过。
    UPDATE todos
       SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
     WHERE id = OLD.id
       AND NEW.updated_at = OLD.updated_at;
END;
```

### 2.4 时间字段维护说明

| 字段         | 维护方     | 说明                                                               |
| ------------ | ---------- | ------------------------------------------------------------------ |
| `created_at` | 应用层     | INSERT 时由应用层写入当前 UTC 时间；DDL 中的 `DEFAULT` 作为兜底。  |
| `updated_at` | 触发器优先 | INSERT 时取默认值；UPDATE 时由数据库触发器自动刷新。应用层也可显式赋值，触发器会跳过覆盖以尊重应用层的值。 |

> **推荐做法**：应用层在 INSERT 时同时设置 `created_at` 和 `updated_at` 为当前 UTC 时间；UPDATE 时不主动设置 `updated_at`，交由触发器自动维护。

---

## 3. 错误处理与分页建议

### 3.1 统一错误响应格式

所有错误响应均使用以下 JSON 结构：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "请求参数校验失败",
    "details": [
      {
        "field": "title",
        "issue": "title 不能为空"
      },
      {
        "field": "priority",
        "issue": "priority 必须是 1 到 5 之间的整数"
      }
    ]
  }
}
```

**字段说明**：

| 字段       | 类型     | 必填 | 说明                                       |
| ---------- | -------- | ---- | ------------------------------------------ |
| `code`     | string   | 是   | 业务错误码（大写蛇形命名），见下方映射表    |
| `message`  | string   | 是   | 面向用户的简要错误描述                      |
| `details`  | array    | 否   | 详细错误信息列表（字段级校验错误时使用）    |

### 3.2 业务错误码映射表

| 业务错误码                 | HTTP 状态码 | 说明                             |
| -------------------------- | ----------- | -------------------------------- |
| `VALIDATION_ERROR`         | 422         | 字段校验失败                     |
| `INVALID_JSON`             | 400         | 请求体非合法 JSON                |
| `INVALID_QUERY_PARAM`      | 400         | 查询参数格式不合法               |
| `TODO_NOT_FOUND`           | 404         | 指定 ID 的 Todo 不存在           |
| `DUPLICATE_TITLE`          | 409         | 标题重复（如业务要求唯一时）     |
| `EMPTY_BATCH_REQUEST`      | 422         | 批量操作的 ids 列表为空          |
| `UNAUTHORIZED`             | 401         | 未认证或认证失效                 |
| `FORBIDDEN`                | 403         | 无权限访问该资源                 |
| `RATE_LIMIT_EXCEEDED`      | 429         | 请求频率超限                     |
| `INTERNAL_ERROR`           | 500         | 服务器内部错误                   |

### 3.3 分页方案

**推荐方案：`limit` + `offset` 偏移分页**

对于 Todo List 这种数据量可控（单用户通常不超过几千条）的场景，偏移分页实现简单、直观，完全满足需求。游标分页更适合无限流式数据（如时间线、日志），此处不需要。

**查询参数**：

| 参数     | 类型    | 默认值 | 约束                    |
| -------- | ------- | ------ | ----------------------- |
| `limit`  | integer | `20`   | 取值范围 1-100          |
| `offset` | integer | `0`    | 取值范围 >= 0           |

**响应中分页元数据**：

```json
{
  "data": [ /* ... */ ],
  "pagination": {
    "total": 42,
    "limit": 20,
    "offset": 0,
    "has_more": true
  }
}
```

| 字段       | 类型    | 说明                               |
| ---------- | ------- | ---------------------------------- |
| `total`    | integer | 符合筛选条件的记录总数             |
| `limit`    | integer | 当前页实际使用的 limit 值          |
| `offset`   | integer | 当前页实际使用的 offset 值         |
| `has_more` | boolean | 是否还有更多数据（`offset + limit < total`） |

**SQL 示例**：

```sql
-- 查询第一页（每页 20 条），按创建时间倒序
SELECT id, title, description, status, priority, due_date, created_at, updated_at
  FROM todos
 WHERE status = 'pending'
 ORDER BY created_at DESC
 LIMIT 20 OFFSET 0;

-- 获取总数（用于 pagination.total）
SELECT COUNT(*) AS total FROM todos WHERE status = 'pending';
```

### 3.4 排序建议

通过 `sort` 查询参数控制排序：

| 用法                    | 含义                              |
| ----------------------- | --------------------------------- |
| `sort=-created_at`      | 按创建时间倒序（默认）            |
| `sort=-priority,due_date` | 优先按优先级降序，再按截止日期升序 |
| `sort=due_date`         | 按截止日期升序                    |
| `sort=-updated_at`      | 按更新时间倒序                    |

**规则**：
- 字段名前缀 `-` 表示降序（DESC），无前缀表示升序（ASC）
- 支持多字段排序，以逗号分隔
- 服务端应校验排序字段是否合法（仅允许 `created_at`、`updated_at`、`due_date`、`priority`、`status`）

**SQL 拼接注意**：排序字段名必须走白名单校验，不能直接拼接用户输入，防止 SQL 注入。

### 3.5 筛选建议

| 筛选维度    | 参数       | 示例                              | 说明                     |
| ----------- | ---------- | --------------------------------- | ------------------------ |
| 状态        | `status`   | `?status=pending`                 | 单选，精确匹配           |
| 优先级      | `priority` | `?priority=5`                     | 单选，精确匹配           |
| 关键词搜索  | `keyword`  | `?keyword=会议`                   | 模糊匹配 title 字段      |

**SQL 示例（带筛选 + 排序 + 分页）**：

```sql
SELECT id, title, description, status, priority, due_date, created_at, updated_at
  FROM todos
 WHERE 1=1
   AND (:status    IS NULL OR status = :status)
   AND (:priority  IS NULL OR priority = :priority)
   AND (:keyword   IS NULL OR title LIKE '%' || :keyword || '%')
 ORDER BY created_at DESC
 LIMIT :limit OFFSET :offset;
```

> 以上使用 SQLite 参数绑定语法（`:param`），应用层根据用户传入的查询参数动态构建 WHERE 子句，未传入的参数绑定为 `NULL`。

---

## 附录：数据模型字段说明

| 字段          | SQLite 存储类型 | 应用层类型          | 必填 | 默认值    | 约束 / 说明                                 |
| ------------- | --------------- | ------------------- | ---- | --------- | ------------------------------------------- |
| `id`          | INTEGER         | integer (int64)     | 是   | 自增      | 主键，`AUTOINCREMENT`                        |
| `title`       | TEXT            | string              | 是   | -         | 1-255 字符                                  |
| `description` | TEXT            | string / null       | 否   | `null`    | 最长 2000 字符                              |
| `status`      | TEXT            | string (enum)       | 是   | `pending` | `pending` / `in_progress` / `completed`     |
| `priority`    | INTEGER         | integer             | 是   | `3`       | 1（最低）- 5（最高）                         |
| `due_date`    | TEXT            | string (ISO 8601) / null | 否 | `null`    | 截止日期，ISO 8601 UTC 格式                  |
| `created_at`  | TEXT            | string (ISO 8601)   | 是   | 当前时间  | 记录创建时间，由应用层写入                   |
| `updated_at`  | TEXT            | string (ISO 8601)   | 是   | 当前时间  | 记录最后更新时间，由触发器自动维护           |

---

> **文档结束** — 本文档为自包含规范，可直接用于前后端协作开发。
