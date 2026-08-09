// 简单的 API 封装：所有请求都走相对路径 /api/v1/todos
// 开发时通过 vite proxy 转发到后端 http://localhost:3000

const BASE = '/api/v1/todos'

// 统一处理 fetch 响应：非 2xx 抛出带 message 的错误
async function handle(res) {
  if (res.status === 204) return null
  const body = await res.json().catch(() => null)
  if (!res.ok) {
    // 后端错误响应为扁平格式 { code, message, details }，优先读 message；
    // 同时兼容老的嵌套 { error: {...} } 格式以防万一
    const msg =
      (body && (body.message || body.code)) ||
      (body && body.error && (body.error.message || body.error.code)) ||
      `请求失败 (${res.status})`
    throw new Error(msg)
  }
  return body
}

// 获取列表：默认拉 100 条，足够小应用展示
export async function fetchTodos() {
  const res = await fetch(`${BASE}?limit=100&offset=0`)
  const body = await handle(res)
  // 列表接口返回 { data: [...], pagination: {...} }
  return (body && body.data) || []
}

// 新增
export async function createTodo(payload) {
  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await handle(res)
  // 创建接口返回 { data: {...} }
  return (body && body.data) || body
}

// 部分更新（如切换状态）
export async function updateTodo(id, payload) {
  const res = await fetch(`${BASE}/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await handle(res)
  return (body && body.data) || body
}

// 删除
export async function deleteTodo(id) {
  const res = await fetch(`${BASE}/${id}`, { method: 'DELETE' })
  await handle(res)
  return true
}
