import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

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
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Using getSession() for performance (reads from cookie, no network round-trip)
  const { data: { session } } = await supabase.auth.getSession()
  const user = session?.user

  const { pathname } = request.nextUrl
  // Local dev: skip invite-code activation gate
  const isDev = process.env.NODE_ENV === 'development'
  const activated = isDev || request.cookies.get('mkr_activated')?.value === '1'

  // Not logged in — /login, /landingpage, / are accessible; others → landing page
  if (!user) {
    if (pathname !== '/login' && pathname !== '/landingpage' && pathname !== '/' && pathname !== '/mcp' && pathname !== '/admin/status' && !pathname.startsWith('/s/')) {
      const url = request.nextUrl.clone()
      url.pathname = '/landingpage'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // Logged in — / → projects
  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = activated ? '/projects' : '/activate'
    return NextResponse.redirect(url)
  }

  // Logged in below this point

  // /login → redirect based on activation status
  if (pathname === '/login') {
    const url = request.nextUrl.clone()
    url.pathname = activated ? '/projects' : '/activate'
    return NextResponse.redirect(url)
  }

  // /activate — accessible when logged in
  if (pathname === '/activate') {
    // Already activated → skip to projects
    if (activated) {
      const url = request.nextUrl.clone()
      url.pathname = '/projects'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // All other routes — require activation
  if (!activated) {
    const url = request.nextUrl.clone()
    url.pathname = '/activate'
    return NextResponse.redirect(url)
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
     * - Static assets (.svg, .png, .jpg, etc.)
     */
    '/((?!_next/static|_next/image|favicon\\.ico|sitemap\\.xml|robots\\.txt|api/|storage/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
