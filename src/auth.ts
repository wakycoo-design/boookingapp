import NextAuth from "next-auth";
import { app } from "@/features/container";
import { adminEmails } from "@/lib/env";
import { enabledLoginProviders, localLoginEnabled, localLoginProvider, passwordLoginProvider } from "@/lib/login-providers";

// Staff sign in with their Google or Zoho accounts, whichever the settings turn on. Only people in the
// staff table (or listed in ADMIN_EMAILS for the very first login) get in.
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    ...enabledLoginProviders().map((p) => p.provider),
    ...(localLoginEnabled() ? [localLoginProvider()] : []),
    passwordLoginProvider(async (email, password) => {
      const member = await app().staff.verifyPassword(email, password);
      return member && { id: member.id, email: member.email, name: member.name };
    }),
  ],
  // The app always runs behind a host's proxy (AppSail, App Runner, a load balancer), which sets the Host header.
  trustHost: true,
  logger: {
    // A cookie signed with an old AUTH_SECRET (or left over from another run) is just "signed out", not an error worth a stack trace.
    error(error) {
      if (error.name === "JWTSessionError") return;
      console.error("[auth][error]", error);
    },
  },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  pages: { signIn: "/login", error: "/login" },
  callbacks: {
    // `user` is the provider profile already mapped to name/email, so this works for Google and Zoho alike.
    async signIn({ user, profile }) {
      const email = user.email;
      if (!email || profile?.email_verified === false) return false;
      const domain = process.env.ALLOWED_EMAIL_DOMAIN?.trim().toLowerCase();
      if (domain && !email.toLowerCase().endsWith(`@${domain}`)) return false;
      const member = await app().staff.resolveLogin({ email, name: user.name }, adminEmails());
      return Boolean(member);
    },
    async jwt({ token, user }) {
      if (user?.email) {
        const member = await app().staff.resolveLogin({ email: user.email, name: user.name }, adminEmails());
        if (member) {
          token.staffId = member.id;
          token.sessionVersion = member.sessionVersion;
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (typeof token.staffId === "string") session.user.staffId = token.staffId;
      // Cookies from before session numbers existed count as 0, the number everyone starts with.
      session.user.sessionVersion = typeof token.sessionVersion === "number" ? token.sessionVersion : 0;
      return session;
    },
  },
});

declare module "next-auth" {
  interface Session {
    user: { staffId?: string; sessionVersion?: number; name?: string | null; email?: string | null; image?: string | null };
  }
}
