import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabaseServer';
import { validateRegistrationInput } from '@/lib/authValidation';
import { getAuthCallbackUrl } from '@/lib/authRedirect';

const pendingMessage = 'If the address can receive mail, confirmation instructions will be sent.';

function noStoreHeaders() {
  return { 'Cache-Control': 'no-store' };
}

function pendingResponse() {
  return NextResponse.json({ message: pendingMessage }, { status: 202, headers: noStoreHeaders() });
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: noStoreHeaders() });
}

function isDuplicateSignupError(error: { code?: string; status?: number; message?: string }) {
  const code = error.code?.toLowerCase();
  const message = error.message?.toLowerCase() || '';
  return code === 'user_already_exists'
    || code === 'email_exists'
    || error.status === 422 && message.includes('already');
}

async function readRegistrationInput(req: NextRequest): Promise<unknown> {
  const contentType = req.headers.get('content-type') || '';
  if (contentType.includes('application/json')) return req.json();

  const form = await req.formData();
  return {
    email: form.get('email'),
    password: form.get('password'),
    name: form.get('name'),
  };
}

export async function POST(req: NextRequest) {
  let input: unknown;
  try {
    input = await readRegistrationInput(req);
  } catch {
    return errorResponse('Please provide a valid registration request.', 400);
  }

  const validation = validateRegistrationInput(input);
  if (!validation.ok) return errorResponse(validation.error, 400);

  const emailRedirectTo = getAuthCallbackUrl();
  if (!emailRedirectTo) return errorResponse('Registration is temporarily unavailable.', 503);

  let supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return errorResponse('Registration is temporarily unavailable.', 503);
  }

  try {
    const { data, error } = await supabase.auth.signUp({
      email: validation.value.email,
      password: validation.value.password,
      options: {
        emailRedirectTo,
        data: { full_name: validation.value.displayName },
      },
    });

    if (error) {
      // Duplicate accounts receive the same generic acceptance response as a
      // successful request. Other Auth failures remain generic and do not
      // disclose provider details or whether an address exists.
      if (isDuplicateSignupError(error)) return pendingResponse();
      return errorResponse('Registration is temporarily unavailable.', 503);
    }

    // Email confirmation must be required. A returned session means the
    // current Auth configuration would grant access before confirmation.
    if (data.session) {
      await supabase.auth.signOut();
      return errorResponse('Registration is temporarily unavailable.', 503);
    }

    if (!data.user) return errorResponse('Registration is temporarily unavailable.', 503);
    return pendingResponse();
  } catch {
    return errorResponse('Registration is temporarily unavailable.', 503);
  }
}

export async function GET() {
  return errorResponse('Method not allowed.', 405);
}
