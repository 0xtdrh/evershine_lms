'use client'

/**
 * Settings centre (5-C, 2026-10-17): every TechNova setting, one card each, grouped, with search (English or Arabic).
 * The list lives in lib/settings/registry.ts; only the cards the person may open are shown (4-level permissions).
 */

import { CardCentre } from '@/components/centers/CardCentre'
import { SETTING_CARDS, SETTINGS_GROUPS } from '@/lib/settings/registry'
import { Settings2 } from 'lucide-react'

export default function SettingsCenterPage() {
  return (
    <CardCentre icon={Settings2} title={['Settings centre', 'مركز الإعدادات']} subtitle={['Every TechNova setting in one place.', 'كل إعدادات TechNova في مكان واحد.']}
      searchHint={['Find a setting…', 'دوّر على إعداد…']} groups={SETTINGS_GROUPS} cards={SETTING_CARDS} />
  )
}
