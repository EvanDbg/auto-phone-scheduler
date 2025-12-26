from datetime import datetime
from sqlalchemy import String, Boolean, Text, DateTime, JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=True)
    command: Mapped[str] = mapped_column(Text, nullable=False)
    cron_expression: Mapped[str] = mapped_column(String(100), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    notify_on_success: Mapped[bool] = mapped_column(Boolean, default=False)
    notify_on_failure: Mapped[bool] = mapped_column(Boolean, default=True)
    # 通知渠道 ID 列表，空列表表示使用所有启用的渠道
    notification_channel_ids: Mapped[list[int] | None] = mapped_column(JSON, nullable=True)
    # 敏感操作自动确认（定时任务默认自动确认，调试模式需要手动确认）
    auto_confirm_sensitive: Mapped[bool] = mapped_column(Boolean, default=True)
    # 指定执行设备 serial，为空则使用全局设置的设备
    device_serial: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=datetime.utcnow, onupdate=datetime.utcnow
    )

    executions: Mapped[list["Execution"]] = relationship(
        "Execution", back_populates="task", cascade="all, delete-orphan"
    )
