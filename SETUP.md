# Menu Planner: Supabase and Vercel setup

The planner works without Supabase and keeps menus in this browser. To sync menus across devices, configure Supabase and Vercel as follows.

## 1. Create the Supabase table

1. Open your Supabase project and choose **SQL Editor → New query**.
2. Copy and run `supabase/migrations/001_create_menus.sql`. If you already ran an earlier copy of this migration, run this updated version again; it safely refreshes the policies and explicitly grants the signed-in role access required by the Data API.
3. Confirm the `public.menus` table appears in **Table Editor**. Row Level Security is enabled and policies restrict each signed-in user to their own rows.

## 2. Configure email sign-in

1. In Supabase, open **Authentication → Providers → Email** and make sure Email is enabled.
2. Open **Authentication → URL Configuration**. Add your deployed Vercel site URL to **Redirect URLs** (for example, `https://your-app.vercel.app/**`). For local development, add `http://localhost:5173/**` too.
3. The app sends a passwordless sign-in link to the email address entered on the page. The link returns to the site, where that user can save, load, and delete their own menus.

## 3. Set Vercel environment variables

1. In Supabase, open **Project Settings → API** (or **API Keys** in the current dashboard).
2. Copy the **Project URL** and the **anon/public** or **publishable** key.
3. In Vercel, open the project **Settings → Environment Variables**.
4. Add `VITE_SUPABASE_URL` with the Project URL and `VITE_SUPABASE_ANON_KEY` with the anon/public or publishable key. Select Production, Preview, and Development as needed.
5. Save the variables, then open **Deployments** and redeploy the latest deployment so the build includes them.

Use only the anon/public or publishable key in this browser app. Never put a service-role or secret key in a `VITE_` variable, source file, or client bundle. The table's Row Level Security policies are what protect user data when using the public key.

## 4. Run locally (optional)

Copy `.env.example` to `.env.local`, fill in the same two public values, then run `npm install` and `npm run dev`.

## Menu storage behavior

Without Supabase configuration or while signed out, saved menus remain in this browser's local storage. When signed in, the app syncs menus to the user's Supabase account. The local browser copy remains available as a fallback.
