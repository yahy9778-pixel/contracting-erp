import { NextResponse, type NextRequest } from "next/server";

// فحص سريع لوجود الجلسة، والتحقق الكامل يتم في الخادم داخل كل صفحة
export function middleware(req: NextRequest) {
  if (!req.cookies.get("erp_session") && !req.nextUrl.pathname.startsWith("/login")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next|favicon.ico).*)"] };
