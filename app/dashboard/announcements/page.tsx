'use client'

/**
 * 5-D targeted announcements (2026-10-17). Everyone: their announcements ("I read it" for important ones).
 * Senders: send (who × where), sent list with reach; approvers: waiting for approval; admins: settings.
 * Tabs open from links with ?tab= (today's tasks, settings / reports centres).
 */

import { useSession } from 'next-auth/react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { L, useI18n } from '@/lib/i18n/client'
import { useUrlTab } from '@/hooks/use-url-tab'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { AnnouncementFeed } from '@/components/announcements/AnnouncementFeed'
import { AnnouncementForm } from '@/components/announcements/AnnouncementForm'
import { AnnouncementList, AnnouncementSettingsCard } from '@/components/announcements/AnnouncementManage'
import { Megaphone } from 'lucide-react'

export default function AnnouncementsPage() {
  useI18n()
  const { data: session } = useSession()
  const { can, ready } = useMyPermissions()
  const [urlTab, setUrlTab] = useUrlTab()
  const role = session?.user?.role ?? ''
  const canSend = ready && can('announcements', 'create')
  const canApprove = ready && can('announcements', 'approve')
  const isAdmin = ['SUPER_ADMIN', 'ADMIN'].includes(role) && canApprove
  return (
    <div className="space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900"><Megaphone className="h-7 w-7 text-indigo-600" /> {L('Announcements', 'الإعلانات')}</h1>
        <p className="mt-1 text-sm text-slate-500">{canSend
          ? L('Send to parents, students, instructors or staff — the whole company, a branch, a partner, a track, a course, a level, a group or chosen students.', 'ابعت لأولياء الأمور أو الطلاب أو المدربين أو الموظفين — الشركة كلها، فرع، شريك، تراك، كورس، مستوى، جروب، أو طلاب بالاسم.')
          : L('News and important notices from TechNova.', 'أخبار وتنبيهات مهمة من TechNova.')}</p>
      </div>
      <Tabs value={urlTab ?? 'inbox'} onValueChange={setUrlTab}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="inbox">{L('My announcements', 'إعلاناتي')}</TabsTrigger>
          {canSend && <TabsTrigger value="new">{L('Send', 'إرسال')}</TabsTrigger>}
          {(canSend || canApprove) && <TabsTrigger value="sent">{L('Sent', 'المبعوتة')}</TabsTrigger>}
          {canApprove && <TabsTrigger value="pending">{L('Waiting approval', 'مستنية موافقة')}</TabsTrigger>}
          {isAdmin && <TabsTrigger value="settings">{L('Settings', 'الإعدادات')}</TabsTrigger>}
        </TabsList>
        <TabsContent value="inbox" className="mt-4"><AnnouncementFeed /></TabsContent>
        {canSend && <TabsContent value="new" className="mt-4"><AnnouncementForm onSent={() => setUrlTab('sent')} /></TabsContent>}
        {(canSend || canApprove) && <TabsContent value="sent" className="mt-4"><AnnouncementList tab="sent" canApprove={canApprove} /></TabsContent>}
        {canApprove && <TabsContent value="pending" className="mt-4"><AnnouncementList tab="pending" canApprove={canApprove} /></TabsContent>}
        {isAdmin && <TabsContent value="settings" className="mt-4"><AnnouncementSettingsCard /></TabsContent>}
      </Tabs>
    </div>
  )
}
