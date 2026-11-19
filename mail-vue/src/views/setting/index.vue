<template>
  <div class="settings-page">
    <el-scrollbar height="100%">
  <div class="box">
    <div class="container">
      <div class="title">{{$t('profile')}}</div>
      <div class="item setting-row">
        <div>{{$t('username')}}</div>
        <div>
          <span v-if="setNameShow" class="edit-name-input">
            <el-input v-model="accountName"  ></el-input>
            <span class="edit-name" @click="setName">
             {{$t('save')}}
            </span>
          </span>
          <span v-else class="user-name">
            <span >{{ userStore.user.name }}</span>
            <span class="edit-name" @click="showSetName">
             {{$t('change')}}
            </span>
          </span>
        </div>
      </div>
      <div class="item setting-row">
        <div>{{$t('emailAccount')}}</div>
        <div>{{ userStore.user.email }}</div>
      </div>
      <div class="item setting-row">
        <div>{{$t('password')}}</div>
        <div>
          <el-button type="primary" @click="pwdShow = true">{{$t('changePwdBtn')}}</el-button>
        </div>
      </div>
      <div class="item setting-row" v-if="passkeySupported">
        <div>{{$t('passkeyTitle')}}</div>
        <div class="passkey-cell">
          <div v-for="item in passkeys" :key="item.passkeyId" class="passkey-row">
            <span class="passkey-name" :title="item.name">{{ item.name || $t('passkeyUnnamed') }}</span>
            <span class="passkey-delete" @click="removePasskey(item)">{{$t('delete')}}</span>
          </div>
          <el-button type="primary" :loading="passkeyAddLoading" @click="openPasskeyDialog">{{$t('passkeyAddBtn')}}</el-button>
        </div>
      </div>
    </div>
    <div class="language">
      <div class="title">{{$t('language')}}</div>
      <div class="language-row setting-row">
        <div>{{$t('preferredLanguage')}}</div>
        <el-select
            :model-value="langSelect"
            class="language-select"
            placeholder="Select"
            @change="changeLang"
        >
          <el-option label="中文" value="zh" @pointerdown.prevent.stop="changeLang('zh')"/>
          <el-option label="English" value="en" @pointerdown.prevent.stop="changeLang('en')"/>
        </el-select>
      </div>
    </div>
    <div class="preference-item">
      <div class="title" id="theme-label">{{$t('themeStyle')}}</div>
      <ThemeSelector/>
    </div>
    <div class="preference-item">
      <div class="title">{{$t('noticeTitle')}}</div>
      <div class="language-row setting-row">
        <div>{{$t('noticeInfo')}}</div>
        <div>
          <el-button @click="uiStore.showNotice()">{{$t('viewNotice')}}</el-button>
        </div>
      </div>
    </div>
    <div class="del-email" v-perm="'my:delete'">
      <div class="title">{{$t('deleteUser')}}</div>
      <div style="color: var(--regular-text-color);">
        {{$t('delAccountMsg')}}
      </div>
      <div>
        <el-button type="primary" @click="deleteConfirm">{{$t('deleteUserBtn')}}</el-button>
      </div>
    </div>
    <el-dialog v-model="pwdShow" :title="$t('changePassword')" width="340">
      <div class="update-pwd">
        <el-input type="password" :placeholder="$t('newPassword')" v-model="form.password" autocomplete="off" @keyup.enter="submitPwd"/>
        <el-input type="password" :placeholder="$t('confirmPassword')" v-model="form.newPwd" autocomplete="off" @keyup.enter="submitPwd"/>
        <el-button type="primary" :loading="setPwdLoading" @click="submitPwd">{{$t('save')}}</el-button>
      </div>
    </el-dialog>
    <el-dialog v-model="passkeyShow" :title="$t('passkeyAddTitle')" width="340" @closed="passkeyName = ''">
      <div class="update-pwd">
        <el-input v-model="passkeyName" :placeholder="$t('passkeyNamePlaceholder')" maxlength="100" @keyup.enter="addPasskey"/>
        <el-button type="primary" :loading="passkeyAddLoading" @click="addPasskey">{{$t('save')}}</el-button>
      </div>
    </el-dialog>
  </div>
    </el-scrollbar>
  </div>
</template>
<script setup>
import {reactive, ref, defineOptions, onMounted} from 'vue'
import {resetPassword, userDelete} from "@/request/my.js";
import {passkeyList, passkeyRegisterOptions, passkeyRegisterVerify, passkeyDelete} from "@/request/passkey.js";
import {startRegistration, browserSupportsWebAuthn} from "@simplewebauthn/browser";
import {useUserStore} from "@/store/user.js";
import router from "@/router/index.js";
import {accountSetName} from "@/request/account.js";
import {useAccountStore} from "@/store/account.js";
import {useI18n} from "vue-i18n";
import {useSettingStore} from "@/store/setting.js";
import {useUiStore} from "@/store/ui.js";
import ThemeSelector from "@/components/theme-selector/index.vue";

const { t } = useI18n()
const accountStore = useAccountStore()
const settingStore = useSettingStore()
const uiStore = useUiStore()
const userStore = useUserStore();
const setPwdLoading = ref(false)
const setNameShow = ref(false)
const accountName = ref(null)
const langSelect = ref(settingStore.lang)

defineOptions({
  name: 'setting'
})

function showSetName() {
  accountName.value = userStore.user.name
  setNameShow.value = true
}

function setName() {

  if (!accountName.value) {
    ElMessage({
      message: t('emptyUserNameMsg'),
      type: 'error',
      plain: true,
    })
    return;
  }

  setNameShow.value = false
  let name = accountName.value

  if (name === userStore.user.name) {
    return
  }

  userStore.user.name = accountName.value

  accountSetName(userStore.user.account.accountId,name).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })

    accountStore.changeUserAccountName = name

  }).catch(() => {
    userStore.user.name = name
  })
}

function changeLang(lang) {
  let setting = {}
  try {
    setting = JSON.parse(localStorage.getItem('setting') || '{}')
  } catch (e) {
    setting = {}
  }
  localStorage.setItem('setting', JSON.stringify({...setting, lang}))
  window.location.reload()
}

const pwdShow = ref(false)
const form = reactive({
  password: '',
  newPwd: '',
})

// ---- Passkey management ----
const passkeySupported = browserSupportsWebAuthn()
const passkeys = ref([])
const passkeyShow = ref(false)
const passkeyName = ref('')
const passkeyAddLoading = ref(false)

onMounted(() => {
  if (passkeySupported) refreshPasskeys()
})

/** Reloads the passkey list from the server. */
function refreshPasskeys() {
  passkeyList().then(rows => {
    passkeys.value = rows
  }).catch(() => {})
}

/** Opens the "add passkey" dialog; the ceremony itself starts on save. */
function openPasskeyDialog() {
  passkeyName.value = ''
  passkeyShow.value = true
}

/**
 * Runs the WebAuthn registration ceremony: fetch server options, invoke the
 * browser authenticator prompt, then submit the attestation for verification.
 */
function addPasskey() {
  if (passkeyAddLoading.value) return
  passkeyAddLoading.value = true
  passkeyRegisterOptions().then(async ({challengeId, options}) => {
    const credential = await startRegistration({optionsJSON: options})
    await passkeyRegisterVerify(challengeId, passkeyName.value, credential)
    ElMessage({message: t('passkeyAddSuccess'), type: 'success', plain: true})
    passkeyShow.value = false
    refreshPasskeys()
  }).catch(e => {
    if (e?.name === 'NotAllowedError') {
      // User cancelled the authenticator prompt - not an error worth a toast.
      return
    }
    if (e?.name) {
      ElMessage({message: t('passkeyFailMsg'), type: 'error', plain: true})
    }
  }).finally(() => {
    passkeyAddLoading.value = false
  })
}

/** Deletes a passkey after user confirmation. */
function removePasskey(item) {
  ElMessageBox.confirm(t('passkeyDeleteConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    passkeyDelete(item.passkeyId).then(() => {
      ElMessage({message: t('saveSuccessMsg'), type: 'success', plain: true})
      refreshPasskeys()
    })
  })
}

const deleteConfirm = () => {
  ElMessageBox.confirm(t('delAccountConfirm'), {
    confirmButtonText: t('confirm'),
    cancelButtonText: t('cancel'),
    type: 'warning'
  }).then(() => {
    userDelete().then(() => {
      localStorage.removeItem('token');
      router.replace('/login');
      ElMessage({
        message: t('delSuccessMsg'),
        type: 'success',
        plain: true,
      })
    })
  })
}


function submitPwd() {

  if (setPwdLoading.value) return

  if (!form.password) {
    ElMessage({
      message: t('emptyPwdMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.password.length < 6) {
    ElMessage({
      message: t('pwdLengthMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  if (form.password !== form.newPwd) {
    ElMessage({
      message: t('confirmPwdFailMsg'),
      type: 'error',
      plain: true,
    })
    return
  }

  setPwdLoading.value = true
  resetPassword(form.password).then(() => {
    ElMessage({
      message: t('saveSuccessMsg'),
      type: 'success',
      plain: true,
    })
    pwdShow.value = false
    setPwdLoading.value = false
    form.password = ''
    form.newPwd = ''
  }).catch(() => {
    setPwdLoading.value = false
  })

}

</script>
<style scoped lang="scss">
.settings-page {
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.box {
  padding: 40px 40px;

  @media (max-width: 767px) {
    padding: 30px 30px;
  }

  .update-pwd {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }

  .title {
    font-size: 18px;
    font-weight: bold;
  }

  .container {
    font-size: 14px;
    display: grid;
    gap: 20px;
    margin-bottom: 40px;

    .item {
      position: relative;
      .user-name {
        display: grid;
        grid-template-columns: minmax(0, auto) max-content;
        justify-content: start;
        align-items: center;
        span:first-child {
          min-width: 0;
          overflow: hidden;
          white-space: nowrap;
          text-overflow: ellipsis;
        }
      }

      .edit-name-input {
        position: absolute;
        bottom: -6px;
        .el-input {
          width: min(200px,calc(100vw - 222px));
        }
      }

      .edit-name {
        color: #4dabff;
        padding-left: 10px;
        white-space: nowrap;
        cursor: pointer;
      }

      .passkey-cell {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;

        .passkey-row {
          display: flex;
          align-items: center;
          gap: 10px;
          max-width: 100%;

          .passkey-name {
            min-width: 0;
            overflow: hidden;
            white-space: nowrap;
            text-overflow: ellipsis;
          }

          .passkey-delete {
            color: var(--el-color-danger);
            white-space: nowrap;
            cursor: pointer;
          }
        }
      }

    }
  }

  .preference-item,
  .language {
    display: flex;
    flex-direction: column;
    gap: 20px;
    margin-bottom: 40px;
    align-items: flex-start;

  }

  .setting-row {
    width: 100%;
    display: grid;
    grid-template-columns: 120px 220px;
    align-items: center;
    column-gap: 110px;
    font-size: 14px;

    > div:first-child {
      font-weight: bold;
      min-width: 0;
      text-align: left;
    }

    > div:last-child {
      min-width: 0;
      overflow: hidden;
      text-align: left;
    }

    @media (max-width: 767px) {
      grid-template-columns: 120px minmax(0, 1fr);
      column-gap: 24px;
    }
  }

  .language-select {
    width: 110px;
    max-width: 100%;
  }

  .del-email {
    font-size: 14px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
}
</style>
