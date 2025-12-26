from datetime import datetime
from pydantic import BaseModel, Field


class TaskBase(BaseModel):
    name: str = Field(..., max_length=100)
    description: str | None = None
    command: str
    cron_expression: str = Field(..., max_length=100)
    enabled: bool = True
    notify_on_success: bool = False
    notify_on_failure: bool = True
    notification_channel_ids: list[int] | None = None  # 空或 None 表示使用所有启用的渠道
    auto_confirm_sensitive: bool = True  # 敏感操作自动确认
    device_serial: str | None = None  # 指定执行设备，为空则使用全局设置


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    name: str | None = Field(None, max_length=100)
    description: str | None = None
    command: str | None = None
    cron_expression: str | None = Field(None, max_length=100)
    enabled: bool | None = None
    notify_on_success: bool | None = None
    notify_on_failure: bool | None = None
    notification_channel_ids: list[int] | None = None
    auto_confirm_sensitive: bool | None = None
    device_serial: str | None = None


class TaskResponse(TaskBase):
    id: int
    created_at: datetime
    updated_at: datetime
    next_run: str | None = None

    class Config:
        from_attributes = True
