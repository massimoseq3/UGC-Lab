// Trigger the download from JS (via a throwaway anchor) rather than wrapping
// the folder in an <a href>, so hovering it shows neither the browser's URL
// preview nor a native tooltip.
//
// Lives beside SkillFolder rather than in it: a file that exports both a
// component and a plain function loses React Fast Refresh.
export function downloadSkill() {
  const link = document.createElement('a')
  link.href = '/video-editor.skill'
  link.download = 'video-editor.skill'
  document.body.appendChild(link)
  link.click()
  link.remove()
}
