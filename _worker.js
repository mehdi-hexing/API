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

    const ipToTest = path.split(']')[0].replace('[', '').split(':')[0];
    const hostHeader = url.searchParams.get('host') || DEFAULT_HOST;
    const traceUrl = `https://${hostHeader}/cdn-cgi/trace`;

    try {
      const response = await fetch(traceUrl, {
        method: 'GET',
        redirect: 'follow',
        cf: {
          resolveOverride: ipToTest
        }
      });

      if (!response.ok) {
        throw new Error(`Trace request failed with status: ${response.status}`);
      }

      const traceText = await response.text();
      const traceData = parseTraceText(traceText);
      const reportedIp = traceData.ip;
      
      if (!reportedIp) {
        throw new Error("Response was successful, but did not contain an IP in the trace data.");
      }

      const { areEquivalent, displayTested, displayReported } = compareIps(ipToTest, reportedIp);

      return createJsonResponse({
        success: true,
        message: "Request was successfully proxied.",
        details: {
          tested_ip_address: displayTested,
          reported_ip_from_trace: displayReported,
          ips_are_equivalent: areEquivalent,
          cloudflare_data_center: traceData.colo || 'N/A',
        },
        raw_trace_data: traceData
      }, 200);

    } catch (err) {
      return createJsonResponse({
        success: false,
        message: "Failed to proxy request.",
        details: {
            tested_ip_address: ipToTest,
            used_host_header: hostHeader,
            error_message: err.message
        }
      }, 502);
    }
  },
};

function compareIps(inputIp, reportedIp) {
  if (!inputIp || !reportedIp) {
    return { areEquivalent: false, displayTested: inputIp, displayReported: reportedIp };
  }

  let normalizedReportedIp = reportedIp;
  const ipv4MappedPrefix = "::ffff:";

  if (reportedIp.startsWith(ipv4MappedPrefix) && !inputIp.includes(':')) {
    const potentialIpv4 = reportedIp.substring(ipv4MappedPrefix.length);
    if (potentialIpv4.includes('.')) {
      normalizedReportedIp = potentialIpv4;
    }
  }
  
  const areEquivalent = inputIp === normalizedReportedIp;

  if (areEquivalent) {
    return { areEquivalent: true, displayTested: inputIp, displayReported: inputIp };
  } else {
    return { areEquivalent: false, displayTested: inputIp, displayReported: reportedIp };
  }
}

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
