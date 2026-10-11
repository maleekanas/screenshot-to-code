import asyncio
import base64
import ipaddress
import os
import socket
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import httpx
from urllib.parse import urlparse

from preview_screenshot.registry import get_url_screenshot_backend

router = APIRouter()


def normalize_url(url: str) -> str:
    """
    Normalize URL to ensure it has a proper protocol.
    If no protocol is specified, default to https://
    """
    url = url.strip()
    
    # Parse the URL
    parsed = urlparse(url)
    
    # Check if we have a scheme
    if not parsed.scheme:
        # No scheme, add https://
        url = f"https://{url}"
    elif parsed.scheme in ['http', 'https']:
        # Valid scheme, keep as is
        pass
    else:
        # Check if this might be a domain with port (like example.com:8080)
        # urlparse treats this as scheme:netloc, but we want to handle it as domain:port
        if ':' in url and not url.startswith(('http://', 'https://', 'ftp://', 'file://')):
            # Likely a domain:port without protocol
            url = f"https://{url}"
        else:
            # Invalid protocol
            raise ValueError(f"Unsupported protocol: {parsed.scheme}")
    
    return url


def bytes_to_data_url(image_bytes: bytes, mime_type: str) -> str:
    base64_image = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{base64_image}"


async def capture_screenshot(
    target_url: str, api_key: str, device: str = "desktop"
) -> bytes:
    api_base_url = "https://api.screenshotone.com/take"

    params = {
        "access_key": api_key,
        "url": target_url,
        "full_page": "true",
        "device_scale_factor": "1",
        "format": "png",
        "block_ads": "true",
        "block_cookie_banners": "true",
        "block_trackers": "true",
        "cache": "false",
        "viewport_width": "342",
        "viewport_height": "684",
    }

    if device == "desktop":
        params["viewport_width"] = "1280"
        params["viewport_height"] = "832"

    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(api_base_url, params=params)
        if response.status_code == 200 and response.content:
            return response.content
        else:
            raise Exception("Error taking screenshot")


def _is_public_ip(address: str) -> bool:
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return ip.is_global and not ip.is_multicast


async def is_public_http_url(url: str) -> bool:
    """True only for http(s) URLs whose host resolves exclusively to public IPs.

    Keeps the local browser from being used to reach localhost, cloud metadata
    endpoints, or other private-network services (SSRF).
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return False
    host = parsed.hostname
    if _is_public_ip(host):
        return True
    try:
        ipaddress.ip_address(host)
        return False
    except ValueError:
        pass
    try:
        loop = asyncio.get_running_loop()
        infos = await loop.getaddrinfo(host, None)
    except (socket.gaierror, UnicodeError):
        return False
    addresses = {str(info[4][0]) for info in infos}
    return bool(addresses) and all(_is_public_ip(a) for a in addresses)


async def capture_screenshot_locally(target_url: str, device: str = "desktop") -> bytes:
    if not await is_public_http_url(target_url):
        raise ValueError("Only publicly reachable http(s) URLs can be captured.")
    backend = get_url_screenshot_backend()
    return await backend.capture_url(
        target_url, device=device, is_url_allowed=is_public_http_url
    )


class ScreenshotRequest(BaseModel):
    url: str
    apiKey: Optional[str] = None


class ScreenshotResponse(BaseModel):
    url: str


@router.post("/api/screenshot")
async def app_screenshot(request: ScreenshotRequest):
    url = request.url
    api_key = (request.apiKey or "").strip() or os.environ.get(
        "SCREENSHOTONE_API_KEY", ""
    ).strip()

    try:
        normalized_url = normalize_url(url)

        if api_key:
            image_bytes = await capture_screenshot(normalized_url, api_key=api_key)
        else:
            image_bytes = await capture_screenshot_locally(normalized_url)

        # Convert the image bytes to a data url
        data_url = bytes_to_data_url(image_bytes, "image/png")

        return ScreenshotResponse(url=data_url)
    except ValueError as e:
        # Handle URL normalization errors
        raise HTTPException(status_code=500, detail=str(e))
    except Exception as e:
        # Handle other errors
        raise HTTPException(status_code=500, detail=f"Error capturing screenshot: {str(e)}")
