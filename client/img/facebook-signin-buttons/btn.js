!function(){if(customElements.get("facebook-signin-button"))return;let t=`
<style>
.fb-signin-button{
  background-color:#1877F2;
  border:none;
  border-radius:4px;
  color:#ffffff;
  cursor:pointer;
  font-family:-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  font-size:14px;
  font-weight:500;
  height:40px;
  padding:0 16px;
  transition:background-color 0.2s;
  width:100%;
  max-width:400px;
}
.fb-signin-button:hover{
  background-color:#166fe5;
}
.fb-signin-button:active{
  background-color:#0d5dbf;
}
.fb-signin-button-wrapper{
  display:flex;
  align-items:center;
  justify-content:center;
  gap:8px;
  height:100%;
}
.fb-signin-button svg{
  width:18px;
  height:18px;
}
</style>
<button class="fb-signin-button" part="button">
  <div class="fb-signin-button-wrapper">
    <svg viewBox="0 0 24 24" fill="white">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
    </svg>
    <span><slot>Log in with Facebook</slot></span>
  </div>
</button>`;class o extends HTMLElement{constructor(){super();let o=this.attachShadow({mode:"closed"});o.innerHTML=t}}customElements.define("facebook-signin-button",o)}();
