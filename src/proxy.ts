import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { matchSupportedLocale } from '@/lib/locales'
import { appendAuthReturnParam, normalizeAuthReturnPath } from '@/lib/auth-return'

export async function proxy(request: NextRequest) {
  const requestedLocale = matchSupportedLocale(request.nextUrl.searchParams.get('locale'))
  const requestedReturnPath = normalizeAuthReturnPath(request.nextUrl.searchParams.get('next'))
  if (requestedLocale) request.cookies.set('locale', requestedLocale)

  let supabaseResponse = NextResponse.next({ request })
  if (requestedLocale) {
    supabaseResponse.cookies.set('locale', requestedLocale, {
      path: '/',
      maxAge: 365 * 24 * 60 * 60,
      sameSite: 'lax',
    })
  }

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          if (requestedLocale) {
            supabaseResponse.cookies.set('locale', requestedLocale, {
              path: '/',
              maxAge: 365 * 24 * 60 * 60,
              sameSite: 'lax',
            })
          }
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Clean up legacy auth cookies from old Supabase URL (before custom domain migration)
  const legacyCookies = request.cookies.getAll().filter(c => c.name.startsWith('sb-sdyrtztrjgmmpnirswxt'))
  if (legacyCookies.length > 0) {
    legacyCookies.forEach(c => {
      supabaseResponse.cookies.set(c.name, '', { path: '/', maxAge: 0 })
    })
  }

  // Handle OAuth PKCE code exchange: Supabase redirects to /?code=xxx
  const code = request.nextUrl.searchParams.get('code')
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Check if new user (no profile yet) → activate + welcome
      const { data: { user } } = await supabase.auth.getUser()
      let isNewUser = false
      if (user) {
        const { data: profile } = await supabase.from('user_profiles').select('activated').eq('id', user.id).single()
        if (!profile?.activated) {
          isNewUser = true
        }
      }

      const url = request.nextUrl.clone()
      url.search = ''
      const destination = requestedReturnPath
        ? (isNewUser ? appendAuthReturnParam(requestedReturnPath, 'welcome', '1') : requestedReturnPath)
        : (isNewUser ? '/home?welcome=1' : '/projects')
      const resolvedDestination = new URL(destination, request.url)
      url.pathname = resolvedDestination.pathname
      url.search = resolvedDestination.search
      url.hash = resolvedDestination.hash
      const response = NextResponse.redirect(url)
      supabaseResponse.cookies.getAll().forEach(c => {
        response.cookies.set(c.name, c.value, { path: '/' })
      })
      response.cookies.set('mkr_activated', '1', { path: '/', maxAge: 365 * 24 * 60 * 60, sameSite: 'lax' })
      return response
    }
  }

  // Using getSession() for performance (reads from cookie, no network round-trip)
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user

  const { pathname } = request.nextUrl
  const isAgentDiscoveryRoute =
    pathname === '/llms.txt' ||
    pathname === '/skill.md' ||
    pathname.startsWith('/.well-known/agent-skills/')
  const isPublicRoute =
    pathname === '/' ||
    isAgentDiscoveryRoute ||
    pathname === '/landingpage' ||
    pathname === '/home' ||
    pathname.startsWith('/home/') ||
    pathname === '/makaron' ||
    pathname === '/agent' ||
    pathname === '/privacy' ||
    pathname === '/support' ||
    pathname.startsWith('/skill/') ||
    pathname === '/claim' ||
    pathname === '/mcp' ||
    pathname === '/admin/status' ||
    pathname.startsWith('/s/') ||
    pathname.startsWith('/releases/') ||
    pathname.startsWith('/use-cases')

  // Not logged in — /login, /landingpage, / are accessible; others → landing page
  if (!user) {
    // Allow /projects/[uuid] through for public project viewing (page-level checks visibility)
    const isProjectView = /^\/projects\/[0-9a-f-]{36}$/.test(pathname)
    if (isProjectView) return supabaseResponse

    if (pathname !== '/login' && !isPublicRoute) {
      const url = request.nextUrl.clone()
      url.pathname = '/home'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Logged in — / → projects
  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = '/projects'
    return NextResponse.redirect(url)
  }

  // Logged in below this point

  // /login → continue to the original safe destination.
  if (pathname === '/login') {
    const url = request.nextUrl.clone()
    const destination = requestedReturnPath || '/projects'
    const resolvedDestination = new URL(destination, request.url)
    url.pathname = resolvedDestination.pathname
    url.search = resolvedDestination.search
    url.hash = resolvedDestination.hash
    return NextResponse.redirect(url)
  }


  // Retired invite-era URL: complete verified auth once, then continue.
  if (pathname === '/activate') {
    const url = request.nextUrl.clone()
    const destination = requestedReturnPath || '/projects'
    const completionPath = `/api/auth/complete?next=${encodeURIComponent(destination)}`
    const resolvedDestination = new URL(completionPath, request.url)
    url.pathname = resolvedDestination.pathname
    url.search = resolvedDestination.search
    url.hash = resolvedDestination.hash
    return NextResponse.redirect(url)
  }

  if (isPublicRoute) {
    return supabaseResponse
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    /*
     * Match all paths except:
     * - _next/static, _next/image (Next.js internals)
     * - favicon.ico, sitemap.xml, robots.txt
     * - /api/* (API routes)
     * - Public Agent discovery files
     * - Static assets (.svg, .png, .jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|llms\\.txt|skill\\.md|\\.well-known/agent-skills/|api/|storage/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
