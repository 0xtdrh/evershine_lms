'use client'

import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchApi } from '@/lib/api-client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { notify } from '@/lib/notify'
import { Loader2, Upload, Trash2, Star, Palette, Type } from 'lucide-react'

type FieldKey = 'studentName' | 'courseName' | 'levelName' | 'issueDate' | 'certificateId' | 'qrCode'

interface FieldLayoutItem {
  key: FieldKey
  label: string
  x: number
  y: number
  fontSizePx: number
  fontFamily: string
  color: string
  align: 'left' | 'center' | 'right'
  bold: boolean
}

interface Template {
  id: string
  name: string
  backgroundUrl: string
  widthPx: number
  heightPx: number
  fieldLayout: FieldLayoutItem[]
  isDefault: boolean
}

const FIELD_OPTIONS: { key: FieldKey; label: string; sample: string }[] = [
  { key: 'studentName', label: 'Student Name', sample: 'Ahmed Mohamed' },
  { key: 'courseName', label: 'Course Name', sample: 'Robotics — Level 2' },
  { key: 'levelName', label: 'Level', sample: 'Level 2' },
  { key: 'issueDate', label: 'Issue Date', sample: '12 September 2026' },
  { key: 'certificateId', label: 'Certificate ID', sample: 'TN-CERT-2026-00001' },
  { key: 'qrCode', label: 'QR Code', sample: '▦' },
]

export default function CertificateTemplatesPage() {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)

  const [name, setName] = useState('')
  const [backgroundBase64, setBackgroundBase64] = useState<string | null>(null)
  const [fields, setFields] = useState<FieldLayoutItem[]>([])
  const [selectedFieldKey, setSelectedFieldKey] = useState<FieldKey | null>(null)
  const [addingKey, setAddingKey] = useState<FieldKey | ''>('')

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ['certificate-templates'],
    queryFn: () => fetchApi('/api/certificate-templates'),
  })

  const createMutation = useMutation({
    mutationFn: () => fetchApi('/api/certificate-templates', {
      method: 'POST',
      body: JSON.stringify({ name, backgroundBase64, fieldLayout: fields, isDefault: templates.length === 0 }),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate-templates'] })
      notify.success('Certificate template saved')
      setName('')
      setBackgroundBase64(null)
      setFields([])
    },
    onError: () => notify.error('Failed to save template'),
  })

  const setDefaultMutation = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/certificate-templates/${id}`, { method: 'PATCH', body: JSON.stringify({ isDefault: true }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate-templates'] })
      notify.success('Default template updated')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => fetchApi(`/api/certificate-templates/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['certificate-templates'] })
      notify.success('Template deleted')
    },
    onError: () => notify.error('Cannot delete — this template is used by existing certificates'),
  })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setBackgroundBase64(reader.result as string)
    reader.readAsDataURL(file)
  }

  const handleCanvasClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedFieldKey || !canvasRef.current) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1000) / 10
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 1000) / 10
    setFields((prev) => prev.map((f) => f.key === selectedFieldKey ? { ...f, x, y } : f))
  }

  const addField = () => {
    if (!addingKey) return
    const opt = FIELD_OPTIONS.find((o) => o.key === addingKey)!
    setFields((prev) => [...prev, {
      key: opt.key, label: opt.label, x: 50, y: 50,
      fontSizePx: opt.key === 'qrCode' ? 100 : 32,
      fontFamily: 'serif', color: '#1e293b', align: 'center', bold: false,
    }])
    setSelectedFieldKey(opt.key)
    setAddingKey('')
  }

  const updateField = (key: FieldKey, patch: Partial<FieldLayoutItem>) => {
    setFields((prev) => prev.map((f) => f.key === key ? { ...f, ...patch } : f))
  }

  const removeField = (key: FieldKey) => {
    setFields((prev) => prev.filter((f) => f.key !== key))
    if (selectedFieldKey === key) setSelectedFieldKey(null)
  }

  const usedKeys = new Set(fields.map((f) => f.key))
  const activeField = fields.find((f) => f.key === selectedFieldKey)

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 flex items-center gap-2">
          <Palette className="w-6 h-6 text-indigo-600" /> Certificate Designer
        </h1>
        <p className="text-sm text-slate-500 mt-1">Upload a certificate background, then click on the design to place each variable exactly where it should print.</p>
      </div>

      {/* Existing templates */}
      {!isLoading && templates.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-3">
          {templates.map((t) => (
            <Card key={t.id} className={t.isDefault ? 'border-indigo-400 ring-1 ring-indigo-200' : ''}>
              <div className="aspect-[1.4] bg-slate-100 relative overflow-hidden rounded-t-xl">
                <img src={t.backgroundUrl} alt={t.name} className="w-full h-full object-cover" />
              </div>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold truncate">{t.name}</span>
                  {t.isDefault && <Badge className="bg-indigo-100 text-indigo-800 border-0 text-[10px]">Default</Badge>}
                </div>
                <div className="flex gap-2">
                  {!t.isDefault && (
                    <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => setDefaultMutation.mutate(t.id)}>
                      <Star className="w-3 h-3" /> Set Default
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" className="gap-1 text-xs text-red-600" onClick={() => deleteMutation.mutate(t.id)}>
                    <Trash2 className="w-3 h-3" /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Designer */}
      <Card className="border-t-4 border-t-indigo-500">
        <CardHeader>
          <CardTitle className="text-base">New Template</CardTitle>
          <CardDescription>Step 1: upload a background. Step 2: add each variable, then click on the image where it should appear.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label>Template Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Robotics Level Certificate 2026" />
            </div>
            <div className="space-y-1">
              <Label>Background Image</Label>
              <input ref={fileInputRef} type="file" accept="image/png, image/jpeg, image/webp" onChange={handleFileChange} className="hidden" />
              <Button variant="outline" size="sm" className="gap-2" onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4" /> {backgroundBase64 ? 'Change Image' : 'Upload Image'}
              </Button>
            </div>
          </div>

          {backgroundBase64 && (
            <>
              <div className="flex items-center gap-2">
                <Select value={addingKey} onValueChange={(v) => setAddingKey(v as FieldKey)}>
                  <SelectTrigger className="max-w-xs"><SelectValue placeholder="Add a variable..." /></SelectTrigger>
                  <SelectContent>
                    {FIELD_OPTIONS.filter((o) => !usedKeys.has(o.key)).map((o) => (
                      <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button size="sm" variant="outline" disabled={!addingKey} onClick={addField}>Add</Button>
              </div>

              <div
                ref={canvasRef}
                onClick={handleCanvasClick}
                className="relative w-full rounded-lg overflow-hidden border-2 border-dashed border-indigo-300 cursor-crosshair select-none"
                style={{ aspectRatio: '1.414 / 1' }}
              >
                <img src={backgroundBase64} alt="Certificate background" className="absolute inset-0 w-full h-full object-cover pointer-events-none" />
                {fields.map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSelectedFieldKey(f.key) }}
                    className={`absolute -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded whitespace-nowrap ${selectedFieldKey === f.key ? 'ring-2 ring-indigo-500 bg-white/80' : 'bg-white/50'}`}
                    style={{
                      left: `${f.x}%`, top: `${f.y}%`,
                      fontSize: `${Math.max(f.fontSizePx / 3, 10)}px`,
                      color: f.color, fontFamily: f.fontFamily,
                      fontWeight: f.bold ? 700 : 400,
                      textAlign: f.align,
                    }}
                  >
                    {FIELD_OPTIONS.find((o) => o.key === f.key)?.sample}
                  </button>
                ))}
              </div>
              <p className="text-xs text-slate-500">Click a field's tag above (or in the list below) to select it, then click anywhere on the image to move it there.</p>

              {fields.length > 0 && (
                <div className="space-y-2">
                  {fields.map((f) => (
                    <div key={f.key} className={`flex items-center gap-3 p-2 rounded-lg border ${selectedFieldKey === f.key ? 'border-indigo-400 bg-indigo-50/50' : 'border-slate-200'}`}>
                      <button type="button" onClick={() => setSelectedFieldKey(f.key)} className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                        <Type className="w-3.5 h-3.5 text-slate-400" /> {f.label}
                      </button>
                      <span className="text-xs text-slate-400">x:{f.x}% y:{f.y}%</span>
                      {selectedFieldKey === f.key && (
                        <div className="flex items-center gap-2 ml-auto">
                          <Input type="number" value={f.fontSizePx} onChange={(e) => updateField(f.key, { fontSizePx: Number(e.target.value) })} className="w-16 h-7 text-xs" title="Font size (px)" />
                          <input type="color" value={f.color} onChange={(e) => updateField(f.key, { color: e.target.value })} className="w-7 h-7 rounded cursor-pointer" />
                          <Select value={f.align} onValueChange={(v) => updateField(f.key, { align: v as 'left' | 'center' | 'right' })}>
                            <SelectTrigger className="w-24 h-7 text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="left">Left</SelectItem>
                              <SelectItem value="center">Center</SelectItem>
                              <SelectItem value="right">Right</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                      <Button size="sm" variant="ghost" className="text-red-500 ml-auto" onClick={() => removeField(f.key)}><Trash2 className="w-3.5 h-3.5" /></Button>
                    </div>
                  ))}
                </div>
              )}

              <Button
                disabled={!name || fields.length === 0 || createMutation.isPending}
                onClick={() => createMutation.mutate()}
                className="gap-2"
              >
                {createMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Save Template
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
