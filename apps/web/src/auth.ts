import NextAuth, { customFetch } from "next-auth";
import GitHub from "next-auth/providers/github";
import { githubFetch } from "./server/retry-fetch";

declare module "next-auth" {
  interface Session {
    user: { id: string; login: string; name?: string | null; email?: string | null; image?: string | null };
  }
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  providers: [
    GitHub({
      clientId: process.env.AUTH_GITHUB_ID,
      clientSecret: process.env.AUTH_GITHUB_SECRET,
      // GitHub Apps authorize with App permissions; keep profile + email for the panel user.
      authorization: { params: { scope: "read:user user:email" } },
      [customFetch]: githubFetch,
    }),
  ],
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    async jwt({ token, profile }) {
      if (profile) {
        const { getContext } = await import("./server/context");
        const { upsertUser } = await import("@foundry/control");
        const p = profile as unknown as {
          login: string;
          id: number;
          email?: string | null;
          name?: string | null;
          avatar_url?: string;
        };
        const user = await upsertUser(await getContext(), {
          ghLogin: p.login,
          ghId: p.id,
          email: p.email ?? null,
          name: p.name ?? null,
          avatarUrl: p.avatar_url ?? null,
        });
        token.userId = user.id;
        token.login = user.ghLogin;
      }
      return token;
    },
    session({ session, token }) {
      session.user.id = token.userId as string;
      session.user.login = token.login as string;
      return session;
    },
  },
});
