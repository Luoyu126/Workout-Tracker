from fastapi import HTTPException, status


def not_found(code: str = "NOT_FOUND", message: str = "Resource not found") -> HTTPException:
    return HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"code": code, "message": message})
