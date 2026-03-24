from fastapi import APIRouter, HTTPException, Request

router = APIRouter()


@router.get("/skills")
async def list_skills(request: Request):
    sm = request.app.state.skill_manager
    return {"skills": sm.skill_list()}


@router.get("/skills/{name}")
async def get_skill(name: str, request: Request):
    sm = request.app.state.skill_manager
    skill = sm._skills.get(name)
    if not skill:
        raise HTTPException(status_code=404, detail=f"技能 '{name}' 不存在")
    return {"name": skill.name, "description": skill.description, "content": skill.full_text}


@router.post("/skills/reload")
async def reload_skills(request: Request):
    sm = request.app.state.skill_manager
    sm.load_all()
    return {"skills": sm.skill_list()}
