from django.conf import settings


class ContentSecurityPolicyMiddleware:
    """Add a Content-Security-Policy header built from settings.CONTENT_SECURITY_POLICY."""

    def __init__(self, get_response):
        self.get_response = get_response
        policy = getattr(settings, "CONTENT_SECURITY_POLICY", None) or {}
        self.header_value = "; ".join(
            f"{directive} {' '.join(sources)}" for directive, sources in policy.items()
        )
        self.header_name = (
            "Content-Security-Policy-Report-Only"
            if getattr(settings, "CSP_REPORT_ONLY", False)
            else "Content-Security-Policy"
        )

    def __call__(self, request):
        response = self.get_response(request)
        # CSP governs documents; on other responses (PDFs, images) it can only get in the way of their viewers.
        is_html = response.get("Content-Type", "").startswith("text/html")
        if self.header_value and is_html and self.header_name not in response:
            response[self.header_name] = self.header_value
        return response
