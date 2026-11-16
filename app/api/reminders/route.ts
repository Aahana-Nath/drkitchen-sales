import { createServerClient } from '@supabase/ssr'
import nodemailer from 'nodemailer'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { todayIST } from '@/lib/format'

export const runtime = 'nodejs'

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest) {
  if (request.headers.get('origin') !== request.nextUrl.origin) {
    return NextResponse.json({ error: 'Request origin is not allowed.' }, { status: 403 })
  }

  let body: { sellerId?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 })
  }
  if (typeof body.sellerId !== 'string' || !uuidPattern.test(body.sellerId)) {
    return NextResponse.json({ error: 'Select a valid seller.' }, { status: 400 })
  }

  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    },
  )

  const { data: { user }, error: authError } = await supabase.auth.getUser()
  if (authError || !user) {
    return NextResponse.json({ error: 'Please log in again before sending a reminder.' }, { status: 401 })
  }

  const { data: caller, error: callerError } = await supabase
    .from('profiles')
    .select('role, region_id, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle()
  if (callerError) {
    return NextResponse.json({ error: 'Could not verify your account permissions.' }, { status: 500 })
  }
  if (!caller?.is_active || !['superadmin', 'regional_manager'].includes(caller.role)) {
    return NextResponse.json({ error: 'Only active managers can send seller reminders.' }, { status: 403 })
  }

  const { data: seller, error: sellerError } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, region_id, is_active')
    .eq('id', body.sellerId)
    .maybeSingle()
  if (sellerError) {
    return NextResponse.json({ error: 'Could not load the selected seller.' }, { status: 500 })
  }
  if (!seller || seller.role !== 'seller' || !seller.is_active ||
      (caller.role === 'regional_manager' && caller.region_id !== seller.region_id)) {
    return NextResponse.json({ error: 'You do not have permission to remind this seller.' }, { status: 403 })
  }

  const recipient = seller.email?.trim().toLowerCase()
  if (!recipient) {
    return NextResponse.json({ error: `${seller.full_name} does not have a login email assigned.` }, { status: 400 })
  }

  const today = todayIST()
  const { data: report, error: reportError } = await supabase
    .from('daily_reports')
    .select('id')
    .eq('seller_id', seller.id)
    .eq('report_date', today)
    .maybeSingle()
  if (reportError) {
    return NextResponse.json({ error: 'Could not verify today’s submission status.' }, { status: 500 })
  }
  if (report) {
    return NextResponse.json({ error: 'This seller has already submitted today.' }, { status: 409 })
  }

  const smtpUser = process.env.SMTP_USER
  const smtpPassword = process.env.SMTP_PASSWORD
  const fromEmail = process.env.SMTP_FROM_EMAIL || smtpUser
  if (!smtpUser || !smtpPassword || !fromEmail) {
    return NextResponse.json({
      error: 'Reminder email is not configured. Add the server-side SMTP settings before sending.',
    }, { status: 503 })
  }

  const port = Number(process.env.SMTP_PORT || '465')
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return NextResponse.json({ error: 'The server SMTP port is invalid.' }, { status: 503 })
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user: smtpUser, pass: smtpPassword },
  })

  try {
    await transporter.sendMail({
      from: {
        name: process.env.SMTP_FROM_NAME || 'DrKitchen Sales',
        address: fromEmail,
      },
      to: recipient,
      subject: 'Reminder: Please submit today’s sales details',
      text: [
        `Hi ${seller.full_name},`,
        '',
        'This is a personal reminder to log today’s sales details in DrKitchen Sales.',
        'Please submit today’s report when you can. If you have already submitted today, you can ignore this reminder.',
        '',
        'DrKitchen Sales',
      ].join('\n'),
    })
  } catch {
    return NextResponse.json({
      error: 'The reminder email could not be sent. Check the server SMTP settings and try again.',
    }, { status: 502 })
  }

  return NextResponse.json({ ok: true })
}
