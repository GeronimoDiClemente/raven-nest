import { useState, useEffect } from 'react'

export interface GitHubNotification {
  id: string
  reason: string
  subject: {
    title: string
    type: 'PullRequest' | 'Issue' | 'Commit'
    url: string
  }
  repository: { full_name: string }
  updated_at: string
  unread: boolean
}

export function useGitHubNotifications(githubToken: string | null) {
  const [notifications, setNotifications] = useState<GitHubNotification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!githubToken) return
    let alive = true

    const fetchNotifications = async () => {
      try {
        const res = await fetch('https://api.github.com/notifications?all=false&per_page=20', {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            Accept: 'application/vnd.github.v3+json',
          },
        })
        if (!res.ok) return
        const data: GitHubNotification[] = await res.json()
        if (!alive) return
        setNotifications(data)
        setUnreadCount(data.filter(n => n.unread).length)
      } catch {
        // silently ignore network errors
      }
    }

    fetchNotifications()
    const interval = setInterval(fetchNotifications, 60_000)
    return () => { alive = false; clearInterval(interval) }
  }, [githubToken])

  const markAsRead = async (notificationId: string) => {
    if (!githubToken) return
    await fetch(`https://api.github.com/notifications/threads/${notificationId}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${githubToken}` },
    })
    setNotifications(prev =>
      prev.map(n => (n.id === notificationId ? { ...n, unread: false } : n))
    )
    setUnreadCount(prev => Math.max(0, prev - 1))
  }

  return { notifications, unreadCount, markAsRead }
}
