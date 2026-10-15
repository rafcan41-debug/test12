# 📡 Porikkha API Reference (Phase 1)

Base URL: `http://localhost:3000` (or your deployed domain).
Auth: JWT in `httpOnly` cookie `pk_token` (set on login/register) **or**
`Authorization: Bearer <token>` header. All `/api/*` except catalog/plans need login.

Error shape: `{ "error": "বাংলা বার্তা" }`.

## Auth — `/api/auth`
| Method | Endpoint | Auth | Body | Notes |
|---|---|---|---|---|
| POST | `/register` | – | `name, email, password, institution?, class?, group?` | rate-limited; sets cookie |
| POST | `/login` | – | `email, password` | rate-limited |
| POST | `/logout` | – | | clears cookie |
| GET | `/me` | ✅ | | also warns on expiring premium |
| PUT | `/profile` | ✅ | `name?, photo_url?, institution?, class?, group?` | |
| PUT | `/change-password` | ✅ | `current, new` | |
| POST | `/forgot` | – | `email` | token → server console + `data/reset-tokens.log` |
| POST | `/reset` | – | `token, password` | |

## Catalog — `/api/catalog`
| GET | `/` | – | | nested categories → subjects → chapters → topics |

## Questions — `/api/questions` (rate-limited)
Student list/detail **never** includes `correct_option`/`explanation`.
| Method | Endpoint | Auth | Query/Body |
|---|---|---|---|
| GET | `/` | ✅ | `subject_id, chapter_id, topic_id, difficulty, prev_year=1, year, source, q, page, limit` |
| GET | `/:id` | ✅ | |
| POST | `/` | teacher/admin | question fields (below) |
| PUT | `/:id` | teacher/admin | partial; teachers only own questions |
| DELETE | `/:id` | teacher/admin | hard-delete if unused, else archive |
| POST | `/:id/publish` | admin | |
| POST | `/import` | teacher/admin | `{ questions: [...] }` max 500, all start as draft |

Question fields: `subject_id*, question_text*, option_a/b/c/d*, correct_option (a–d)*,
explanation, marks, difficulty (easy/medium/hard), tags, prev_year (bool),
year (1900–2100), source ("SSC Dhaka Board"), chapter_id, topic_id, status`.

## Exams — `/api/exams`
| Method | Endpoint | Auth | Notes |
|---|---|---|---|
| GET | `/` | ✅ | `?category_id=`; students see published only |
| GET | `/:id` | ✅ | meta (no answers) |
| GET | `/:id/my-attempts` | ✅ | own attempts |
| POST | `/` | teacher/admin | `title*, category_id, duration_min*, negative_mark, pass_marks, selection_mode (fixed/filter), filter{subject_id,chapter_id,topic_id,difficulty,year,source,prev_year,limit}, question_limit, question_ids[]` |
| PUT | `/:id` | teacher/admin | |
| POST | `/:id/publish` | teacher/admin | notifies all users |
| POST | `/:id/archive` | teacher/admin | |
| POST | `/:id/start` | ✅ | free cap: 3/day; returns stripped questions + `ends_at` |
| GET | `/attempts/:id` | ✅ | resume state (stripped questions + saved answers) |
| POST | `/attempts/:id/save` | ✅ | `{ answers: {qid: 'a'} }` autosave |
| POST | `/attempts/:id/submit` | ✅ | **server-side scoring**; returns score breakdown |
| GET | `/attempts/:id/review` | ✅ | full review w/ correct answers + explanations (submitted only) |

## Practice — `/api/practice`
| POST | `/start` | ✅ | `{subject_id?, chapter_id?, topic_id?, difficulty?, year?, source?, prev_year?, limit}` |
| POST | `/:sid/answer` | ✅ | `{question_id, selected}` → `{correct, correct_option, explanation}`; free cap 20/day |
| POST | `/:sid/finish` | ✅ | |
| GET | `/history` | ✅ | last 30 sessions |

## Bookmarks — `/api/bookmarks`
| GET `/` | ✅ | list (stripped) |
| POST `/` | ✅ | `{question_id}` |
| DELETE `/:questionId` | ✅ | |

## Leaderboard — `/api/leaderboard`
| GET | `/exam/:examId?limit=` | ✅ | tie-break: score ↓, time ↑, submitted ↑ |
| GET | `/period?range=daily\|weekly\|monthly` | ✅ | |

## Payments — `/api/payments` (manual bKash, ৳299 / 30 days)
| POST `/` | ✅ | `{bkash_txn_id*, sender_number?}` |
| GET `/mine` | ✅ | |
| GET `/?status=` | admin | |
| POST `/:id/approve` | admin | activates premium 30 days |
| POST `/:id/reject` | admin | `{note?}` |
| GET `/plans` | – | free vs premium |

## Notifications — `/api/notifications`
| GET `/` | ✅ | `{notifications, unread}` |
| POST `/:id/read`, POST `/read-all` | ✅ | |

## Tickets — `/api/tickets`
| POST `/` | ✅ | `{subject*, message*}` |
| GET `/mine` | ✅ | |
| GET `/` | admin | `?status=` |
| GET `/:id` | ✅ | ticket + replies (own or admin) |
| POST `/:id/reply` | ✅ | `{message*}` |
| POST `/:id/close` | ✅ | |

## Admin — `/api/admin` (admin only)
| GET `/stats` | | users/questions/exams/payments/tickets counts |
| GET `/users?role=&q=&page=` | | |
| PUT `/users/:id` | | `{name?, role?, status?, plan?, institution?, class?, group?, premium_until?}` |
| GET `/audit?limit=` | | |
| GET `/reports/results.csv?exam_id=` | | CSV download |

## AI — `/api/ai`
| POST `/explain` | ✅ | **501** stub — wire a provider later (no API keys in Phase 1) |
