"use client"
import { useState, useMemo } from "react"

export function usePagination<T>(items: T[], pageSize = 10) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(pageSize)
  const totalPages = Math.max(1, Math.ceil(items.length / size))
  const currentPage = Math.min(page, totalPages)
  const paginated = useMemo(() => {
    const start = (currentPage - 1) * size
    return items.slice(start, start + size)
  }, [items, currentPage, size])
  const range = { from: items.length === 0 ? 0 : (currentPage - 1) * size + 1, to: Math.min(currentPage * size, items.length), total: items.length }
  return { paginated, currentPage, totalPages, size, setPage, setSize, range }
}
