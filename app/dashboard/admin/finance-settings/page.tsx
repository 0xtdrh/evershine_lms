'use client'

import { AccountsManager } from '@/components/treasury/AccountsManager'
import { useMyPermissions } from '@/hooks/use-my-permissions'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { notify } from '@/lib/notify'
import { AccessDenied } from '@/components/AccessDenied'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowDown, ArrowUp, Landmark, Loader2, Plus, Receipt, Save, Trash2, Wallet } from 'lucide-react'
import { OnlinePaymentsCard } from '@/components/fees/OnlinePaymentsCard'
import { L, useI18n } from '@/lib/i18n/client'

interface Account {
  id?: string
  kind: string
  label: string
  accountName: string | null
  accountNumber: string | null
  bankName: string | null
  iban: string | null
  instructions: string | null
  isActive: boolean
}
interface Method { id?: string; name: string; isActive: boolean; isSystem?: boolean }
interface Finance {
  invoiceDueDays: number
  receiptPaper: '80mm' | '58mm' | 'A4'
  receiptAfterPayment: 'OPEN' | 'PRINT' | 'NONE'
  companyName: string
  companyPhone: string
  companyAddress: string
  receiptFooter: string
  autoSendReceiptWhatsApp: boolean
}
interface Settings { finance: Finance; accounts: Account[]; methods: Method[]; autoWhatsAppAvailable?: boolean; onlinePayment?: boolean }

const KINDS: { value: string; label: string }[] = [
  { value: 'INSTAPAY', label: 'InstaPay' },
  { value: 'VODAFONE_CASH', label: 'Vodafone Cash' },
  { value: 'BANK', label: 'Bank account' },
  { value: 'FAWRY', label: 'Fawry' },
  { value: 'OTHER', label: 'Other' },
]

function move<T>(list: T[], i: number, d: -1 | 1): T[] {
  const j = i + d
  if (j < 0 || j >= list.length) return list
  const copy = [...list]
  ;[copy[i], copy[j]] = [copy[j], copy[i]]
  return copy
}

export default function FinanceSettingsPage() {
  useI18n() // re-render on a language switch
  const { can: canPerm } = useMyPermissions()
  const canTreasury = canPerm('treasury', 'update')
  const { data: session, status } = useSession()
  const role = session?.user?.role
  const qc = useQueryClient()
  const { data: perms } = useQuery({
    queryKey: ['my-permissions', role],
    queryFn: () => fetchApi<{ permissions: Record<string, string[]> }>('/api/me/permissions'),
    enabled: status === 'authenticated' && !!role,
  })
  const canRead = !!perms?.permissions?.finance_settings?.includes('read')
  const canEdit = !!perms?.permissions?.finance_settings?.includes('update')

  const { data, isLoading } = useQuery({
    queryKey: ['finance-settings'],
    queryFn: () => fetchApi<Settings>('/api/admin/finance-settings'),
    enabled: canRead,
  })
  const [form, setForm] = useState<Settings | null>(null)
  useEffect(() => {
    if (data) setForm(data)
  }, [data])

  const save = useMutation({
    mutationFn: (body: Settings) => fetchApi<Settings>('/api/admin/finance-settings', { method: 'PUT', body: JSON.stringify(body) }),
    onSuccess: (res) => {
      notify.success(L('Payment settings saved', 'إعدادات الدفع اتحفظت'))
      setForm(res)
      qc.invalidateQueries({ queryKey: ['finance-settings'] })
      qc.invalidateQueries({ queryKey: ['payment-methods'] })
      qc.invalidateQueries({ queryKey: ['payment-accounts'] })
    },
    onError: (err: Error) => notify.error(err.message || 'Could not save'),
  })

  if (status === 'loading' || (status === 'authenticated' && !perms)) return null
  if (!canRead) return <AccessDenied />
  if (isLoading || !form) return <p className="p-6 text-sm text-muted-foreground">{L('Loading…', 'بيحمّل…')}</p>

  const setAccount = (i: number, patch: Partial<Account>) =>
    setForm({ ...form, accounts: form.accounts.map((a, k) => (k === i ? { ...a, ...patch } : a)) })
  const setFinance = (patch: Partial<Finance>) => setForm({ ...form, finance: { ...form.finance, ...patch } })
  const setMethod = (i: number, patch: Partial<Method>) =>
    setForm({ ...form, methods: form.methods.map((m, k) => (k === i ? { ...m, ...patch } : m)) })

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold"><Wallet className="h-6 w-6" /> {L('Payment settings', 'إعدادات الدفع')}</h1>
          <p className="text-sm text-muted-foreground">{L('Where parents send money, the methods staff record, and when invoices are due.', 'الأهالي بيبعتوا الفلوس فين، وطرق الدفع اللي الموظفين بيسجلوها، وإمتى الفواتير بتستحق.')}</p>
        </div>
        {canEdit && (
          <Button onClick={() => save.mutate(form)} disabled={save.isPending}>
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
            {L('Save', 'حفظ')}
          </Button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Landmark className="h-4 w-4" /> {L('Accounts for payments', 'حسابات الدفع')}</CardTitle>
          <CardDescription>{L('Shown on every invoice and in the parent portal. Parents transfer to these and upload the receipt.', 'بتظهر على كل فاتورة وفي بوابة ولي الأمر. الأهالي بيحوّلوا عليها ويرفعوا الإيصال.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.accounts.length === 0 && (
            <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              {L('No account yet: invoices will tell parents to pay at the branch.', 'لسه مفيش حساب: الفواتير هتقول للأهالي يدفعوا في الفرع.')}
            </p>
          )}
          {form.accounts.map((a, i) => (
            <div key={a.id ?? `new-${i}`} className="space-y-3 rounded-xl border p-3">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1">
                  <Label>{L('Type', 'النوع')}</Label>
                  <Select value={a.kind} onValueChange={(v) => setAccount(i, { kind: v })} disabled={!canEdit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>{L('Name shown to parents', 'الاسم اللي بيظهر للأهالي')}</Label>
                  <Input value={a.label} onChange={(e) => setAccount(i, { label: e.target.value })} placeholder={L('e.g. InstaPay', 'مثلاً InstaPay')} disabled={!canEdit} />
                </div>
                <div className="space-y-1">
                  <Label>{a.kind === 'BANK' ? 'Account number' : 'Number / handle'}</Label>
                  <Input dir="ltr" value={a.accountNumber ?? ''} onChange={(e) => setAccount(i, { accountNumber: e.target.value })} placeholder={a.kind === 'INSTAPAY' ? 'name@instapay or 01…' : '01…'} disabled={!canEdit} />
                </div>
                <div className="space-y-1">
                  <Label>{L('Account holder name', 'اسم صاحب الحساب')}</Label>
                  <Input value={a.accountName ?? ''} onChange={(e) => setAccount(i, { accountName: e.target.value })} disabled={!canEdit} />
                </div>
                {a.kind === 'BANK' && (
                  <>
                    <div className="space-y-1">
                      <Label>{L('Bank', 'البنك')}</Label>
                      <Input value={a.bankName ?? ''} onChange={(e) => setAccount(i, { bankName: e.target.value })} disabled={!canEdit} />
                    </div>
                    <div className="space-y-1">
                      <Label>IBAN</Label>
                      <Input dir="ltr" value={a.iban ?? ''} onChange={(e) => setAccount(i, { iban: e.target.value })} disabled={!canEdit} />
                    </div>
                  </>
                )}
              </div>
              <div className="space-y-1">
                <Label>{L('Note for parents (optional)', 'ملاحظة للأهالي (اختياري)')}</Label>
                <Textarea rows={2} value={a.instructions ?? ''} onChange={(e) => setAccount(i, { instructions: e.target.value })} placeholder={L('e.g. Write the student name in the transfer note, then upload the screenshot.', 'مثلاً: اكتب اسم الطالب في ملاحظة التحويل، وبعدين ارفع صورة الشاشة.')} disabled={!canEdit} />
              </div>
              {canEdit && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={a.isActive} onChange={(e) => setAccount(i, { isActive: e.target.checked })} />
                    {L('Shown to parents', 'ظاهر للأهالي')}
                  </label>
                  <div className="flex gap-1">
                    <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, accounts: move(form.accounts, i, -1) })} aria-label={L('Move up', 'لفوق')}><ArrowUp className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, accounts: move(form.accounts, i, 1) })} aria-label={L('Move down', 'لتحت')}><ArrowDown className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, accounts: form.accounts.filter((_, k) => k !== i) })} aria-label={L('Remove', 'شيل')}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {canEdit && (
            <Button
              variant="outline"
              onClick={() => setForm({ ...form, accounts: [...form.accounts, { kind: 'INSTAPAY', label: 'InstaPay', accountName: null, accountNumber: null, bankName: null, iban: null, instructions: null, isActive: true }] })}
            >
              <Plus className="mr-2 h-4 w-4" /> {L('Add account', 'ضيف حساب')}
            </Button>
          )}
        </CardContent>
      </Card>

      <OnlinePaymentsCard connected={!!form.onlinePayment} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L('Payment methods', 'طرق الدفع')}</CardTitle>
          <CardDescription>{L('The list staff pick from when recording a payment. Old payments keep the name they were recorded with.', 'القايمة اللي الموظفين بيختاروا منها وقت تسجيل الدفع. المدفوعات القديمة بتفضل بالاسم اللي اتسجلت بيه.')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {form.methods.map((m, i) => (
            <div key={m.id ?? `new-${i}`} className="flex flex-wrap items-center gap-2 rounded border px-3 py-2">
              <Input className="max-w-xs" value={m.name} onChange={(e) => setMethod(i, { name: e.target.value })} disabled={!canEdit || m.isSystem} />
              {m.isSystem && <span className="text-xs text-muted-foreground">{L('built-in', 'أساسية')}</span>}
              <label className="ml-auto flex items-center gap-2 text-sm">
                <input type="checkbox" checked={m.isActive} onChange={(e) => setMethod(i, { isActive: e.target.checked })} disabled={!canEdit} />
                {L('Active', 'شغالة')}
              </label>
              {canEdit && (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, methods: move(form.methods, i, -1) })} aria-label={L('Move up', 'لفوق')}><ArrowUp className="h-4 w-4" /></Button>
                  <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, methods: move(form.methods, i, 1) })} aria-label={L('Move down', 'لتحت')}><ArrowDown className="h-4 w-4" /></Button>
                  {!m.isSystem && (
                    <Button size="icon" variant="ghost" onClick={() => setForm({ ...form, methods: form.methods.filter((_, k) => k !== i) })} aria-label={L('Remove', 'شيل')}><Trash2 className="h-4 w-4 text-red-600" /></Button>
                  )}
                </div>
              )}
            </div>
          ))}
          {canEdit && (
            <Button variant="outline" onClick={() => setForm({ ...form, methods: [...form.methods, { name: '', isActive: true }] })}>
              <Plus className="mr-2 h-4 w-4" /> {L('Add method', 'ضيف طريقة')}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{L('Invoices', 'الفواتير')}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Label htmlFor="dueDays">{L('A new group invoice is due after', 'فاتورة الجروب الجديدة بتستحق بعد')}</Label>
          <Input
            id="dueDays"
            type="number"
            min={0}
            max={90}
            className="w-24"
            value={form.finance.invoiceDueDays}
            onChange={(e) => setForm({ ...form, finance: { ...form.finance, invoiceDueDays: Math.max(0, Math.min(90, Number(e.target.value) || 0)) } })}
            disabled={!canEdit}
          />
          <span className="text-sm">{L('days', 'يوم')}</span>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base"><Receipt className="h-4 w-4" /> Receipts &amp; printer</CardTitle>
          <CardDescription>{L('Every payment gets a receipt (TN-RCPT-…). Print it, or send it to the parent on WhatsApp.', 'كل دفعة ليها إيصال (TN-RCPT-…). اطبعه أو ابعته لولي الأمر واتساب.')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>{L('Printer / paper', 'الطابعة / الورق')}</Label>
            <Select value={form.finance.receiptPaper} onValueChange={(v) => setFinance({ receiptPaper: v as Finance['receiptPaper'] })} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="80mm">{L('Receipt printer (thermal) 80 mm', 'طابعة إيصالات (حرارية) 80 مم')}</SelectItem>
                <SelectItem value="58mm">{L('Receipt printer (thermal) 58 mm', 'طابعة إيصالات (حرارية) 58 مم')}</SelectItem>
                <SelectItem value="A4">{L('Normal printer (A4)', 'طابعة عادية (A4)')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{L('After recording a payment', 'بعد تسجيل الدفع')}</Label>
            <Select value={form.finance.receiptAfterPayment} onValueChange={(v) => setFinance({ receiptAfterPayment: v as Finance['receiptAfterPayment'] })} disabled={!canEdit}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="OPEN">{L('Open the receipt', 'افتح الإيصال')}</SelectItem>
                <SelectItem value="PRINT">{L('Open the receipt and print it', 'افتح الإيصال واطبعه')}</SelectItem>
                <SelectItem value="NONE">{L('Do nothing (link in the message)', 'ماتعملش حاجة (اللينك في الرسالة)')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>{L('Name on the receipt', 'الاسم على الإيصال')}</Label>
            <Input value={form.finance.companyName} onChange={(e) => setFinance({ companyName: e.target.value })} disabled={!canEdit} />
          </div>
          <div className="space-y-1">
            <Label>{L('Phone on the receipt', 'التليفون على الإيصال')}</Label>
            <Input dir="ltr" value={form.finance.companyPhone} onChange={(e) => setFinance({ companyPhone: e.target.value })} disabled={!canEdit} />
          </div>
          <div className="space-y-1">
            <Label>{L('Address on the receipt', 'العنوان على الإيصال')}</Label>
            <Input value={form.finance.companyAddress} onChange={(e) => setFinance({ companyAddress: e.target.value })} disabled={!canEdit} />
          </div>
          <div className="space-y-1">
            <Label>{L('Message at the bottom', 'رسالة تحت')}</Label>
            <Input value={form.finance.receiptFooter} onChange={(e) => setFinance({ receiptFooter: e.target.value })} disabled={!canEdit} />
          </div>
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={form.finance.autoSendReceiptWhatsApp}
              disabled={!canEdit || !form.autoWhatsAppAvailable}
              onChange={(e) => setFinance({ autoSendReceiptWhatsApp: e.target.checked })}
            />
            <span>{L('Send the receipt to the parent on WhatsApp automatically', 'ابعت الإيصال لولي الأمر واتساب تلقائي')}
              <span className="block text-xs text-muted-foreground">
                {form.autoWhatsAppAvailable
                  ? 'WhatsApp Business API is connected.'
                  : 'Needs a WhatsApp Business API account (later). Until then, staff send it with one click from the receipt.'}
              </span>
            </span>
          </label>
        </CardContent>
      </Card>
      {canTreasury && <AccountsManager />}
    </div>
  )
}
