{{-- Blade. Skrivefeilen med vilje er <lt-feild>. --}}
<form action="{{ route('soknad.send') }}" method="post" novalidate>
  @csrf
  <lt-field @if($errors->has('epost')) invalid @endif>
    <label class="lt-label" data-required="text">E-postadresse</label>
    <input class="lt-input" type="email" name="epost" value="{{ old('epost') }}" @class(['feil' => $errors->has('epost')])>
    @error('epost')
      <p class="lt-error-text">{{ $message }}</p>
    @enderror
  </lt-field>
  <label><input class="lt-checkbox" type="{{ $kind }}" name="extra"> Extra</label>
  <a class="lt-button" href="{{ $url }}">Back</a>
  <lt-feild></lt-feild>
  <button class="lt-button" data-variant="{{ $utkast ? 'secondary' : '' }}" type="submit">Send</button>
</form>
