import { useState, useEffect, useCallback } from 'react'
import { fetchTodos, createTodo, updateTodo, deleteTodo } from './api.js'

export default function App() {
  // 列表数据、加载态、错误态、新增输入
  const [todos, setTodos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [input, setInput] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // 拉取列表：mount 时以及操作后调用
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await fetchTodos()
      setTodos(data)
    } catch (e) {
      setError(e.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // 新增：回车或点按钮触发
  const handleAdd = useCallback(
    async (e) => {
      e && e.preventDefault()
      const title = input.trim()
      if (!title) return
      setSubmitting(true)
      setError('')
      try {
        const created = await createTodo({ title })
        // 成功后加到列表头部
        setTodos((prev) => [created, ...prev])
        setInput('')
      } catch (err) {
        setError(err.message || '新增失败')
      } finally {
        setSubmitting(false)
      }
    },
    [input]
  )

  // 切换完成状态：pending <-> completed
  const handleToggle = useCallback(async (todo) => {
    const next = todo.status === 'completed' ? 'pending' : 'completed'
    try {
      const updated = await updateTodo(todo.id, { status: next })
      setTodos((prev) => prev.map((t) => (t.id === todo.id ? updated : t)))
    } catch (err) {
      setError(err.message || '更新失败')
    }
  }, [])

  // 删除
  const handleDelete = useCallback(async (id) => {
    try {
      await deleteTodo(id)
      setTodos((prev) => prev.filter((t) => t.id !== id))
    } catch (err) {
      setError(err.message || '删除失败')
    }
  }, [])

  return (
    <div className="app">
      <h1>Todo List</h1>

      {/* 新增表单 */}
      <form className="add-form" onSubmit={handleAdd}>
        <input
          type="text"
          placeholder="输入新待办，回车提交"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={submitting}
        />
        <button type="submit" disabled={submitting || !input.trim()}>
          添加
        </button>
      </form>

      {/* 错误提示 */}
      {error && (
        <div className="error-bar">
          {error}
          <button
            onClick={() => setError('')}
            style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            x
          </button>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="loading">加载中...</div>
      ) : todos.length === 0 ? (
        <div className="empty">暂无待办，添加一条试试</div>
      ) : (
        <ul className="todo-list">
          {todos.map((todo) => (
            <li
              key={todo.id}
              className={`todo-item ${todo.status === 'completed' ? 'completed' : ''}`}
            >
              <input
                type="checkbox"
                checked={todo.status === 'completed'}
                onChange={() => handleToggle(todo)}
              />
              <span className="todo-title">{todo.title}</span>
              <span className="todo-priority">P{todo.priority}</span>
              <button className="todo-delete" onClick={() => handleDelete(todo.id)}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
