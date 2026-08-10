import { useEffect } from 'react'
import { useAuthStore } from '../../stores/authStore'
import { useAnnouncementStore } from '../../stores/announcementStore'
import AnnouncementAlert from './AnnouncementAlert'
import AnnouncementsPanel from './AnnouncementsPanel'

// Mounts the two announcement overlays at workspace level and does the one
// fetch they both read from.
//
// Deliberately not wired into cloudSync.startCloudSync: announcements aren't
// banks, they don't hydrate into bankStore, and a failure here must not sit in
// the path of the sync that carries the member's own work.

export default function AnnouncementsHost() {
  const userId = useAuthStore((s) => s.user?.id)
  const load = useAnnouncementStore((s) => s.load)

  useEffect(() => {
    if (!userId) return
    void load()
  }, [userId, load])

  return (
    <>
      <AnnouncementsPanel />
      <AnnouncementAlert />
    </>
  )
}
