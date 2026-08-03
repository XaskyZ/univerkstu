export interface AddLessonUi {
    editLesson: string;
    addLesson: string;
    subject: string;
    subjectPlaceholder: string;
    type: string;
    day: string;
    dayNames: string[];
    typeLabels: { srsp: string; curator_hour: string; other: string };
    time: string;
    bySlots: string;
    customTime: string;
    start: string;
    end: string;
    hours: string;
    minutes: string;
    decHour: string;
    incHour: string;
    decMinute: string;
    incMinute: string;
    invalidTime: string;
    week: string;
    every: string;
    numerator: string;
    denominator: string;
    teacher: string;
    room: string;
    optional: string;
    delete: string;
    save: string;
    add: string;
}

const RU: AddLessonUi = {
    editLesson: 'Редактировать пару',
    addLesson: '📌 Добавить пару',
    subject: 'Предмет *',
    subjectPlaceholder: 'Например: СРСП по математике',
    type: 'Тип',
    day: 'День',
    dayNames: ['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ'],
    typeLabels: {
        srsp: 'СРСП',
        curator_hour: 'Кураторский час',
        other: 'Другое',
    },
    time: 'Время',
    bySlots: 'По парам',
    customTime: 'Свое время',
    start: 'Начало',
    end: 'Конец',
    hours: 'Часы',
    minutes: 'Минуты',
    decHour: '- ч',
    incHour: '+ ч',
    decMinute: '- мин',
    incMinute: '+ мин',
    invalidTime: 'Время окончания должно быть позже времени начала.',
    week: 'Неделя',
    every: 'Каждая',
    numerator: 'Числитель',
    denominator: 'Знаменатель',
    teacher: 'Преподаватель',
    room: 'Аудитория',
    optional: 'Необязательно',
    delete: 'Удалить',
    save: 'Сохранить',
    add: 'Добавить',
};

const KZ: AddLessonUi = {
    editLesson: 'Сабақты өңдеу',
    addLesson: '📌 Сабақ қосу',
    subject: 'Пән *',
    subjectPlaceholder: 'Мысалы: Математика бойынша СРСП',
    type: 'Түрі',
    day: 'Күн',
    dayNames: ['ДС', 'СС', 'СР', 'БС', 'ЖМ', 'СБ'],
    typeLabels: {
        srsp: 'СРСП',
        curator_hour: 'Куратор сағаты',
        other: 'Басқа',
    },
    time: 'Уақыты',
    bySlots: 'Жұптар бойынша',
    customTime: 'Өз уақыты',
    start: 'Басы',
    end: 'Соңы',
    hours: 'Сағат',
    minutes: 'Минут',
    decHour: '- сағ',
    incHour: '+ сағ',
    decMinute: '- мин',
    incMinute: '+ мин',
    invalidTime: 'Аяқталу уақыты басталу уақытынан кейін болуы керек.',
    week: 'Апта',
    every: 'Әр апта',
    numerator: 'Алым',
    denominator: 'Бөлім',
    teacher: 'Оқытушы',
    room: 'Аудитория',
    optional: 'Міндетті емес',
    delete: 'Жою',
    save: 'Сақтау',
    add: 'Қосу',
};

const EN: AddLessonUi = {
    editLesson: 'Edit lesson',
    addLesson: '📌 Add lesson',
    subject: 'Subject *',
    subjectPlaceholder: 'For example: Math practice',
    type: 'Type',
    day: 'Day',
    dayNames: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    typeLabels: {
        srsp: 'SRSP',
        curator_hour: 'Curator hour',
        other: 'Other',
    },
    time: 'Time',
    bySlots: 'By slots',
    customTime: 'Custom time',
    start: 'Start',
    end: 'End',
    hours: 'Hours',
    minutes: 'Minutes',
    decHour: '- h',
    incHour: '+ h',
    decMinute: '- min',
    incMinute: '+ min',
    invalidTime: 'End time must be later than start time.',
    week: 'Week',
    every: 'Every',
    numerator: 'Numerator',
    denominator: 'Denominator',
    teacher: 'Teacher',
    room: 'Room',
    optional: 'Optional',
    delete: 'Delete',
    save: 'Save',
    add: 'Add',
};

export function getAddLessonUi(language: 'ru' | 'kz' | 'en'): AddLessonUi {
    if (language === 'kz') return KZ;
    if (language === 'en') return EN;
    return RU;
}
