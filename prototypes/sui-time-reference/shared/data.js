window.SuiTimePrototype = {
  storageKey: 'sui-time-reference:v1',
  today: '2026-08-03',
  initialData: {
    profile: { name: '暴走的小陌', phone: '182****9035', gender: 'male', signature: '暴走方知深浅' },
    settings: { darkSidebar: true, compactMenu: false, weekOnly: true, hideCompleted: true },
    tags: [
      { id: 'work', name: '工作', color: '#7299d5', icon: '▣' },
      { id: 'growth', name: '自增', color: '#12bd75', icon: '▮' },
      { id: 'life', name: '生活', color: '#ff8545', icon: '♨' }
    ],
    tasks: [
      { id: 't1', title: '一体化门户集成', tagId: 'growth', date: '2026-08-03', schedule: 'allDay', time: '', priority: 'notUrgentImportant', repeat: 'none', notes: '梳理门户的统一登录与数据集成范围。', status: 'todo', subtasks: ['确认应用清单', '同步接口负责人'] },
      { id: 't2', title: '一件收费隐藏功能', tagId: 'growth', date: '2026-08-03', schedule: 'allDay', time: '', priority: 'notUrgentImportant', repeat: 'none', notes: '', status: 'todo', subtasks: [] },
      { id: 't3', title: '采购实施方案后续字段维护', tagId: 'work', date: '2026-08-03', schedule: 'allDay', time: '', priority: 'notUrgent', repeat: 'none', notes: '补充实施阶段字段说明。', status: 'todo', subtasks: [] },
      { id: 't4', title: '谷歌账户注册（手机号）', tagId: 'life', date: '2026-08-03', schedule: 'allDay', time: '', priority: 'urgent', repeat: 'none', notes: '', status: 'todo', subtasks: [] },
      { id: 't5', title: '软考-系统架构师', tagId: 'growth', date: '2026-08-03', schedule: 'allDay', time: '', priority: 'notUrgentImportant', repeat: 'none', notes: '', status: 'todo', subtasks: ['第一章', '第二章', '整理错题'] },
      { id: 't6', title: '回标分析-投标人与投标文件分析', tagId: 'work', date: '2026-08-04', schedule: 'allDay', time: '', priority: 'notUrgent', repeat: 'none', notes: '', status: 'todo', subtasks: ['资格审查', '价格对比', '文件归档'] },
      { id: 't7', title: 'AI-回标分析-公开公式分析', tagId: 'work', date: '2026-08-04', schedule: 'allDay', time: '', priority: 'notUrgent', repeat: 'none', notes: '', status: 'todo', subtasks: ['数据提取', '公式复核'] },
      { id: 't8', title: '去上海', tagId: 'life', date: '2026-08-04', schedule: 'point', time: '18:30', priority: 'urgent', repeat: 'none', notes: '提前确认车票。', status: 'todo', subtasks: [] },
      { id: 't9', title: '房租', tagId: 'life', date: '2026-08-06', schedule: 'point', time: '08:00', priority: 'urgent', repeat: 'monthly', notes: '', status: 'todo', subtasks: [] },
      { id: 't10', title: '工时、周报', tagId: 'work', date: '2026-08-07', schedule: 'point', time: '19:00', priority: 'notUrgent', repeat: 'weekly', notes: '', status: 'todo', subtasks: [] },
      { id: 't11', title: '值班', tagId: 'life', date: '2026-08-08', schedule: 'allDay', time: '', priority: 'urgent', repeat: 'weekly', notes: '', status: 'todo', subtasks: [] },
      { id: 't12', title: '小敏敏33岁生日', tagId: 'life', date: '2026-08-03', schedule: 'allDay', time: '', priority: 'urgent', repeat: 'yearly', notes: '', status: 'done', subtasks: [] }
    ]
  }
};
