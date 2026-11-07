# Security policy

Report vulnerabilities privately through GitHub's "Report a vulnerability" form on this repository (Security tab), not in a public issue.

In scope: the stdio server or CLI contacting any host other than the configured API base; the Worker leaking request data between callers (it must stay stateless); a way for catalogue text to be interpreted as instructions by the server or CLI; CORS or header handling that lets a page read responses it should not.

Design notes: the client reads only the configured base URL (default `https://artsnet.com/api/v1`), sends no credentials, and validates response shape before use. The Worker creates a fresh server and transport per request and keeps no sessions. Tool descriptions label results as data.
