// Supabase Edge Function: Send email via Microsoft Graph API
// Uses your Azure app (Client ID, Tenant ID, Client Secret) - no SMTP needed

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SendEmailRequest {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

async function getAccessToken(): Promise<string> {
  const tenantId = Deno.env.get('GRAPH_TENANT_ID')!;
  const clientId = Deno.env.get('GRAPH_CLIENT_ID')!;
  const clientSecret = Deno.env.get('GRAPH_CLIENT_SECRET')!;

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token request failed: ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function sendMail(token: string, senderEmail: string, payload: SendEmailRequest): Promise<void> {
  const toList = Array.isArray(payload.to) ? payload.to : [payload.to];
  const toRecipients = toList.map((addr) => ({
    emailAddress: { address: addr },
  }));

  const body = payload.html || payload.text || '';
  const contentType = payload.html ? 'HTML' : 'Text';

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(senderEmail)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: payload.subject,
          body: { contentType, content: body },
          toRecipients,
        },
        saveToSentItems: true,
      }),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`sendMail failed: ${res.status} ${err}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS, status: 204 });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 405 }
    );
  }

  try {
    const body = (await req.json()) as SendEmailRequest;
    const { to, subject, text, html } = body;

    if (!to || !subject) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields: to, subject' }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    const senderEmail = Deno.env.get('GRAPH_SENDER_EMAIL');
    if (!senderEmail) {
      return new Response(
        JSON.stringify({ error: 'GRAPH_SENDER_EMAIL not configured' }),
        { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    const token = await getAccessToken();
    await sendMail(token, senderEmail, { to, subject, text, html });

    return new Response(
      JSON.stringify({ success: true, message: 'Email sent successfully' }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 200 }
    );
  } catch (error) {
    console.error('Send email error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to send email',
      }),
      { headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
