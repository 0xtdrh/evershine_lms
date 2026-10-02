/**
 * WhatsApp sending. Server-only.
 *
 * Today: no WhatsApp Business API account, so messages are sent by staff with
 * one click (a wa.me link opens WhatsApp with the text ready — see
 * whatsappNumber in lib/students/portal-password.ts).
 *
 * Later (owner, 2026-10-02): automatic sending through the WhatsApp Business
 * (Cloud) API. Set WHATSAPP_CLOUD_TOKEN and WHATSAPP_PHONE_NUMBER_ID in the
 * host's environment; isAutoWhatsAppConfigured() then returns true and the
 * "send receipts automatically" setting can be switched on.
 */

import { whatsappNumber } from '@/lib/students/portal-password'

export function isAutoWhatsAppConfigured(): boolean {
  return !!(process.env.WHATSAPP_CLOUD_TOKEN?.trim() && process.env.WHATSAPP_PHONE_NUMBER_ID?.trim())
}

/**
 * Sends a text message automatically. Returns false (never throws) when the
 * API is not configured or the send fails — callers keep the manual button.
 * NOTE: business-initiated messages need an approved template on Meta's side;
 * wire the template name here when the account is set up.
 */
export async function sendWhatsAppText(phone: string, text: string): Promise<boolean> {
  if (!isAutoWhatsAppConfigured()) return false
  const to = whatsappNumber(phone)
  if (!to) return false
  try {
    const res = await fetch(`https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
    })
    return res.ok
  } catch (err) {
    console.error('[WHATSAPP_SEND]', err)
    return false
  }
}
