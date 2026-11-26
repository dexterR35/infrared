"""Optional process kept warm on loopback. The application authorizes each input before dispatch."""
import asyncio
import hmac
import os
import secrets
from typing import Literal

from fastapi import FastAPI, HTTPException, Request
import uvicorn

from analyze import analyze

app=FastAPI(docs_url=None,redoc_url=None,openapi_url=None)
lock=asyncio.Lock()


@app.post("/{kind}")
async def research(kind:Literal["experiment","reference"],request:Request):
    token=os.environ.get("INFRARED_RESEARCH_TOKEN","")
    if len(token)<32 or not hmac.compare_digest(request.headers.get("authorization","").encode(),("Bearer "+token).encode()):
        raise HTTPException(403)
    if lock.locked():
        raise HTTPException(429)
    async with lock:
        payload=bytearray()
        async for chunk in request.stream():
            if len(chunk)+len(payload)>16_000_000:
                raise HTTPException(413)
            payload.extend(chunk)
        redis=None
        lease=secrets.token_hex(24)
        if os.environ.get("INFRARED_RESEARCH_REDIS"):
            from redis.asyncio import Redis
            redis=Redis.from_url(os.environ["INFRARED_RESEARCH_REDIS"],socket_connect_timeout=2,socket_timeout=2)
            try:
                acquired=await redis.set("infrared:research:cpu",lease,nx=True,ex=300)
            except Exception:
                await redis.aclose()
                raise HTTPException(503,detail="Research capacity unavailable") from None
            if not acquired:
                await redis.aclose()
                raise HTTPException(429)
        try:
            return await asyncio.to_thread(analyze,kind,bytes(payload))
        except (KeyError,ValueError,TypeError):
            raise HTTPException(422,detail="Invalid analysis input") from None
        finally:
            if redis:
                try:
                    await redis.eval("if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end return 0",1,"infrared:research:cpu",lease)
                finally:
                    await redis.aclose()


if __name__=="__main__":
    if len(os.environ.get("INFRARED_RESEARCH_TOKEN",""))<32:
        raise SystemExit("Configure a shared INFRARED_RESEARCH_TOKEN of at least 32 characters")
    uvicorn.run(app,host="127.0.0.1",port=8765,access_log=False,limit_concurrency=4)
