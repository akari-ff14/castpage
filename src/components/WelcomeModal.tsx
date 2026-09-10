import { useState } from 'react'
import {
  Home as HomeIcon,
  MessageSquare,
  Calendar,
  ListChecks,
  TrendingUp,
  ChevronRight,
} from '../icons'
import './WelcomeModal.css'

interface Props {
  onClose: () => void
  castName: string
  isStaff: boolean
}

interface Slide {
  icon: typeof HomeIcon
  title: string
  body: string
}

const SLIDES: Slide[] = [
  {
    icon: HomeIcon,
    title: 'ようこそ、対話店[灯] へ',
    body: '左メニューから「ホーム」を選ぶと、今の接客状況・使用中ルーム・今日の予約・売上がひと目で確認できます。',
  },
  {
    icon: MessageSquare,
    title: '接客の開始と進行管理',
    body: '「接客」メニューでお客さまを迎えて応対を開始します。応対中は延長・オプション・終了などを大きなボタンで操作できます。',
  },
  {
    icon: Calendar,
    title: '予約と顧客の管理',
    body: '「予約」で事前/当日予約を管理、「顧客」で過去にご来店いただいた方の履歴が確認できます。問題のあったお客さまは「ブラックリスト」へ。',
  },
  {
    icon: TrendingUp,
    title: '売上の確認',
    body: '「売上」メニューで本日のキャスト別収益・給与・差額が確認できます。営業終了時のチェックにご活用ください。',
  },
  {
    icon: ListChecks,
    title: '迷ったらこの画面に戻りましょう',
    body: 'すべての機能は左のメニューから自由に行き来できます。困ったらいつでも「ホーム」に戻ってください。',
  },
]

// スタッフは接客をしないので、接客の操作説明を予約受付の説明に差し替える
const STAFF_SLIDES: Slide[] = [
  {
    icon: HomeIcon,
    title: 'ようこそ、対話店[灯] へ',
    body: '左メニューから「ホーム」を選ぶと、承認待ちの申込・使用中ルーム・今日の予約・売上がひと目で確認できます。',
  },
  {
    icon: Calendar,
    title: 'お客様の申込を承認する',
    body: '「予約」メニューの先頭に、お客様からの申込と日時変更の申請が並びます。承認するとお客様に確定が伝わります。受け付ける日そのものは「管理」→「受付日」で作ります。',
  },
  {
    icon: Calendar,
    title: '予約と顧客の管理',
    body: '「予約」で店内の予約も登録・編集できます。「顧客」で過去にご来店いただいた方の履歴が確認でき、問題のあったお客さまは「ブラックリスト」へ。',
  },
  {
    icon: TrendingUp,
    title: '売上の確認',
    body: '「売上」メニューで本日のキャスト別収益・給与・差額が確認できます。営業終了時のチェックにご活用ください。',
  },
  {
    icon: ListChecks,
    title: '迷ったらこの画面に戻りましょう',
    body: 'すべての機能は左のメニューから自由に行き来できます。困ったらいつでも「ホーム」に戻ってください。',
  },
]

export default function WelcomeModal({ onClose, castName, isStaff }: Props) {
  const [step, setStep] = useState(0)
  const slides = isStaff ? STAFF_SLIDES : SLIDES
  const last = step === slides.length - 1
  const Slide = slides[step]
  const Icon = Slide.icon

  function next() {
    if (last) onClose()
    else setStep((s) => s + 1)
  }

  return (
    <div className="welcome-overlay" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <div className="welcome-content">
        <div className="welcome-icon-wrap">
          <Icon size={32} />
        </div>
        <h2 id="welcome-title" className="welcome-title">{Slide.title}</h2>
        <p className="welcome-body">{Slide.body}</p>

        <div className="welcome-dots" aria-hidden>
          {slides.map((_, i) => (
            <span key={i} className={`welcome-dot ${i === step ? 'active' : ''}`} />
          ))}
        </div>

        <div className="welcome-actions">
          <button className="btn-secondary" onClick={onClose}>スキップ</button>
          <button className="welcome-next" onClick={next}>
            {last ? `${castName} さんとしてはじめる` : '次へ'}
            {!last && <ChevronRight size={16} />}
          </button>
        </div>
      </div>
    </div>
  )
}
