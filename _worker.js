// A default host to use if the user doesn't provide one.
const DEFAULT_HOST = 'www.cloudflare.com';

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return handleOptions();
    }

    const url = new URL(request.url);
    const path = url.pathname.slice(1);

    if (!path) {
      return createJsonResponse({
        error: "Please provide an IP address in the URL path.",
        usage: "Example: /1.2.3.4?host=your.sni.com"
      }, 400);
    }

    // --- The Two Crucial Inputs ---
    // 1. The IP to test, taken from the URL path.
    const ipToTest = path.split(']')[0].replace('[', '').split(':')[0];
    
    // 2. The Host/SNI to use, taken from a query parameter. Fallback to a reliable default.
    const hostHeader = url.searchParams.get('host') || DEFAULT_HOST;
    
    // The target URL uses the hostHeader, which is essential for the Host and SNI.
    const traceUrl = `https://${hostHeader}/cdn-cgi/trace`;

    try {
      // --- The Definitive Logic, now with correct parameters ---
      const response = await fetch(traceUrl, {
        method: 'GET',
        redirect: 'follow',
        // This 'cf' object correctly combines the two critical inputs.
        cf: {
          // It resolves the HOST to the IP you want to test.
          resolveOverride: ipToTest
        }
      });

      if (!response.ok) {
        throw new Error(`Trace request to host '${hostHeader}' failed with status: ${response.status}`);
      }

      const traceText = await response.text();
      const traceData = parseTraceText(traceText);

      // The final validation remains the same: the IP reported by Cloudflare must match the IP we tested.
      const isVerifiedProxy = traceData.ip === ipToTest;

      return createJsonResponse({
        success: isVerifiedProxy,
        tested_ip: ipToTest,
        used_host: hostHeader,
        details: {
          is_proxy: isVerifiedProxy,
          reported_ip_by_trace: traceData.ip || 'N/A',
          data_center: traceData.colo || 'N/A',
        },
        raw_trace_data: traceData
      }, 200);

    } catch (err) {
      return createJsonResponse({
        success: false,
        tested_ip: ipToTest,
        used_host: hostHeader,
        error: "Test failed. The IP may not be a valid proxy for the specified host.",
        details: err.message
      }, 502);
    }
  },
};

// --- Helper Functions ---

function parseTraceText(text) {
  try {
    return Object.fromEntries(text.trim().split('\n').map(line => line.split('=')));
  } catch {
    return {};
  }
}

function createJsonResponse(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function handleOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, User-Agent'
    }
  });
}
